const MAX_REASON_LENGTH = 800;
const MAX_DETAIL_LENGTH = 300;
const MAX_REQUEST_ID_LENGTH = 200;
const MAX_VALIDATION_DETAILS = 12;

export type McpValidationDetail = {
  field?: string;
  message: string;
  code?: string;
};

export type McpFailureDiagnostic = {
  operation: string;
  stage?: string;
  integration?: string;
  status?: number;
  code?: string;
  reason: string;
  requestId?: string;
  validationDetails?: McpValidationDetail[];
  retry: {
    safe: boolean;
    guidance: string;
    afterSeconds?: number;
  };
};

type FailureOptions = {
  operation: string;
  stage?: string;
  integration?: string;
  status?: number;
  code?: string | number;
  reason?: string;
  requestId?: string;
  validationDetails?: McpValidationDetail[];
  retrySafe?: boolean;
  retryGuidance?: string;
  retryAfterSeconds?: number;
  requestWasSent?: boolean;
};

const SECRET_KEY_PATTERN =
  /(authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|cookie)/gi;
const SECRET_VALUE_PATTERN =
  /\b(bearer\s+)[a-z0-9._~+/-]+=*|([?&](?:access_token|api_key|key|token)=)[^&\s]+|\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/gi;

/** Keep provider diagnostics useful without echoing credentials or huge bodies. */
export function sanitizeMcpDiagnosticText(
  value: unknown,
  maxLength = MAX_DETAIL_LENGTH,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const redacted = value
    .replace(SECRET_VALUE_PATTERN, (_match, bearer, queryPrefix) =>
      bearer
        ? `${bearer}[redacted]`
        : queryPrefix
          ? `${queryPrefix}[redacted]`
          : "[redacted]",
    )
    .replace(
      new RegExp(
        `(["']?${SECRET_KEY_PATTERN.source}["']?\\s*[:=]\\s*)["']?[^\\s,"'}]+`,
        "gi",
      ),
      "$1[redacted]",
    )
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!redacted) return undefined;
  return redacted.slice(0, maxLength);
}

function finiteStatus(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const status = Math.trunc(value);
  return status >= 100 && status <= 599 ? status : undefined;
}

function scalarCode(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const code = sanitizeMcpDiagnosticText(String(value), 100);
  return code && code !== "[redacted]" ? code : undefined;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function defaultRetry(options: FailureOptions) {
  const { status, code, requestWasSent = true } = options;
  if (!requestWasSent) {
    return {
      safe: true,
      guidance:
        options.retryGuidance ??
        "Correct the request or connection, then retry; no provider action was sent.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      safe: false,
      guidance:
        options.retryGuidance ??
        "Reconnect the integration or fix its permissions before retrying.",
    };
  }
  if (status === 404 || status === 400 || status === 409 || status === 422) {
    return {
      safe: false,
      guidance:
        options.retryGuidance ??
        "Correct the identifier, range, state, or validation errors before retrying.",
    };
  }
  if (status === 429) {
    return {
      safe: true,
      guidance:
        options.retryGuidance ??
        "Retry after the provider's rate-limit window.",
    };
  }
  if (code === "TIMEOUT" || code === "CONNECTION_ERROR" || (status && status >= 500)) {
    return {
      safe: false,
      guidance:
        options.retryGuidance ??
        "The outcome may be unknown. Verify whether the action completed before retrying to avoid duplicates.",
    };
  }
  return {
    safe: options.retrySafe ?? false,
    guidance:
      options.retryGuidance ??
      "Review the reason and verify the provider state before retrying.",
  };
}

export function createMcpFailureDiagnostic(
  options: FailureOptions,
): McpFailureDiagnostic {
  const operation =
    sanitizeMcpDiagnosticText(options.operation, 160) ?? "integration tool";
  const rawReason = sanitizeMcpDiagnosticText(
    options.reason,
    MAX_REASON_LENGTH,
  );
  const reason =
    !rawReason || /^(failed|error|unknown error)$/i.test(rawReason)
      ? `The integration reported that ${operation} failed without a specific reason.`
      : rawReason;
  const status = finiteStatus(options.status);
  const code = scalarCode(options.code);
  const retry = defaultRetry({ ...options, status, code });
  const validationDetails = (options.validationDetails ?? [])
    .map((detail) => ({
      ...(sanitizeMcpDiagnosticText(detail.field, 160)
        ? { field: sanitizeMcpDiagnosticText(detail.field, 160) }
        : {}),
      message:
        sanitizeMcpDiagnosticText(detail.message, MAX_DETAIL_LENGTH) ??
        "Invalid value",
      ...(scalarCode(detail.code) ? { code: scalarCode(detail.code) } : {}),
    }))
    .slice(0, MAX_VALIDATION_DETAILS);

  return {
    operation,
    ...(sanitizeMcpDiagnosticText(options.stage, 100)
      ? { stage: sanitizeMcpDiagnosticText(options.stage, 100) }
      : {}),
    ...(sanitizeMcpDiagnosticText(options.integration, 160)
      ? { integration: sanitizeMcpDiagnosticText(options.integration, 160) }
      : {}),
    ...(status !== undefined ? { status } : {}),
    ...(code ? { code } : {}),
    reason,
    ...(sanitizeMcpDiagnosticText(options.requestId, MAX_REQUEST_ID_LENGTH)
      ? {
          requestId: sanitizeMcpDiagnosticText(
            options.requestId,
            MAX_REQUEST_ID_LENGTH,
          ),
        }
      : {}),
    ...(validationDetails.length > 0 ? { validationDetails } : {}),
    retry: {
      safe: options.retrySafe ?? retry.safe,
      guidance: retry.guidance,
      ...(options.retryAfterSeconds !== undefined
        ? { afterSeconds: Math.max(0, Math.ceil(options.retryAfterSeconds)) }
        : {}),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseJsonText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function payloadCandidates(payload: unknown): unknown[] {
  const parsed = parseJsonText(payload);
  const candidates: unknown[] = [parsed];
  const root = asRecord(parsed);
  if (!root) return candidates;
  for (const key of [
    "error",
    "data",
    "structuredContent",
    "result",
    "response",
  ]) {
    if (root[key] !== undefined) candidates.push(parseJsonText(root[key]));
  }
  const content = root.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const record = asRecord(block);
      if (record?.text !== undefined) {
        candidates.push(parseJsonText(record.text));
      }
    }
  }
  return candidates;
}

function findKnownValue(
  payload: unknown,
  keys: ReadonlySet<string>,
  depth = 0,
): unknown {
  if (depth > 5) return undefined;
  const record = asRecord(payload);
  if (!record) {
    if (Array.isArray(payload)) {
      for (const item of payload.slice(0, 20)) {
        const found = findKnownValue(item, keys, depth + 1);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }
  for (const [key, value] of Object.entries(record)) {
    if (keys.has(key.toLowerCase()) && value !== undefined) return value;
  }
  for (const value of Object.values(record)) {
    const found = findKnownValue(value, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findKnownValues(
  payload: unknown,
  keys: ReadonlySet<string>,
  depth = 0,
): unknown[] {
  if (depth > 5) return [];
  if (Array.isArray(payload)) {
    return payload
      .slice(0, 20)
      .flatMap((item) => findKnownValues(item, keys, depth + 1));
  }
  const record = asRecord(payload);
  if (!record) return [];
  const direct = Object.entries(record)
    .filter(([key, value]) => keys.has(key.toLowerCase()) && value !== undefined)
    .map(([, value]) => value);
  return [
    ...direct,
    ...Object.values(record).flatMap((value) =>
      findKnownValues(value, keys, depth + 1),
    ),
  ];
}

const REASON_KEYS = new Set([
  "message",
  "reason",
  "error_description",
  "userpresentablemessage",
  "detail",
]);
const REQUEST_ID_KEYS = new Set([
  "requestid",
  "request_id",
  "correlationid",
  "correlation_id",
  "traceid",
  "trace_id",
]);
const RETRYABLE_KEYS = new Set([
  "retryable",
  "isretryable",
  "safetoretry",
  "safe_to_retry",
]);
const RETRY_AFTER_KEYS = new Set([
  "retryafterseconds",
  "retry_after_seconds",
  "retryafter",
  "retry_after",
]);

function extractValidationDetails(payload: unknown): McpValidationDetail[] {
  const details: McpValidationDetail[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || details.length >= MAX_VALIDATION_DETAILS) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 30)) visit(item, depth + 1);
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    const field = scalarCode(
      record.field ??
        record.fieldPath ??
        record.path ??
        record.parameter ??
        record.argument,
    );
    const message = sanitizeMcpDiagnosticText(
      record.description ?? record.message ?? record.reason,
      MAX_DETAIL_LENGTH,
    );
    if (message && (field || depth > 0)) {
      details.push({
        ...(field ? { field } : {}),
        message,
        ...(scalarCode(record.code) ? { code: scalarCode(record.code) } : {}),
      });
    }
    for (const [key, nested] of Object.entries(record)) {
      if (
        [
          "details",
          "errors",
          "fieldviolations",
          "validationerrors",
          "violations",
          "extensions",
        ].includes(key.toLowerCase())
      ) {
        visit(nested, depth + 1);
      }
    }
  };
  visit(payload, 0);
  return details;
}

export function diagnosticFromMcpPayload(
  operation: string,
  payload: unknown,
  fallbackReason?: string,
): McpFailureDiagnostic {
  const candidates = payloadCandidates(payload);
  const reasonValue = candidates
    .map((candidate) => findKnownValue(candidate, REASON_KEYS))
    .find((value) => typeof value === "string");
  const statusValue = candidates
    .flatMap((candidate) =>
      findKnownValues(
        candidate,
        new Set(["statuscode", "httpstatus", "http_status"]),
      ),
    )
    .find((value) => finiteStatus(value) !== undefined);
  const codeValues = candidates.flatMap((candidate) =>
    findKnownValues(
        candidate,
        new Set(["code", "errorcode", "error_code", "status", "type"]),
      ),
  );
  // Providers commonly return both a numeric HTTP-ish code and a semantic
  // status (Google: 400 + INVALID_ARGUMENT). Preserve both when available.
  const rawCode =
    codeValues.find((value) => typeof value === "string") ??
    codeValues.find((value) => scalarCode(value) !== undefined);
  const numericCodeStatus = finiteStatus(rawCode);
  const numericStatus =
    finiteStatus(statusValue) ??
    codeValues.map(finiteStatus).find((value) => value !== undefined);
  const requestId = candidates
    .map((candidate) => findKnownValue(candidate, REQUEST_ID_KEYS))
    .find((value) => typeof value === "string");
  const retryable = candidates
    .map((candidate) => findKnownValue(candidate, RETRYABLE_KEYS))
    .find((value) => typeof value === "boolean");
  const retryAfter = candidates
    .map((candidate) => findKnownValue(candidate, RETRY_AFTER_KEYS))
    .find((value) => typeof value === "number" || typeof value === "string");
  const retryAfterSeconds =
    typeof retryAfter === "number"
      ? retryAfter
      : typeof retryAfter === "string"
        ? parseRetryAfter(retryAfter)
        : undefined;
  const validationDetails = candidates.flatMap(extractValidationDetails);

  return createMcpFailureDiagnostic({
    operation,
    status: numericStatus,
    code: numericCodeStatus ? undefined : rawCode as string | number | undefined,
    reason:
      sanitizeMcpDiagnosticText(reasonValue, MAX_REASON_LENGTH) ??
      sanitizeMcpDiagnosticText(fallbackReason, MAX_REASON_LENGTH),
    requestId:
      typeof requestId === "string" ? requestId : undefined,
    validationDetails,
    ...(typeof retryable === "boolean" ? { retrySafe: retryable } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  });
}

function headerRequestId(headers: Headers): string | undefined {
  for (const name of [
    "x-request-id",
    "request-id",
    "x-correlation-id",
    "correlation-id",
    "traceparent",
  ]) {
    const value = headers.get(name);
    if (value) return value;
  }
  return undefined;
}

export async function diagnosticFromHttpResponse(
  operation: string,
  response: Response,
): Promise<McpFailureDiagnostic> {
  let payload: unknown;
  try {
    const text = await response.text();
    payload = parseJsonText(text);
  } catch {
    payload = undefined;
  }
  const fromPayload = diagnosticFromMcpPayload(
    operation,
    payload,
    `${operation} was rejected with HTTP ${response.status}.`,
  );
  const candidates = payloadCandidates(payload);
  const retryable = candidates
    .map((candidate) => findKnownValue(candidate, RETRYABLE_KEYS))
    .find((value) => typeof value === "boolean");
  const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
  return createMcpFailureDiagnostic({
    ...fromPayload,
    status: response.status,
    requestId: headerRequestId(response.headers) ?? fromPayload.requestId,
    // Recompute guidance from the final HTTP status. Only an explicit
    // provider retryability flag may override the status-based policy.
    ...(typeof retryable === "boolean" ? { retrySafe: retryable } : {}),
    retryAfterSeconds:
      retryAfterSeconds ?? fromPayload.retry.afterSeconds,
  });
}

export function diagnosticFromThrownError(
  operation: string,
  error: unknown,
): McpFailureDiagnostic {
  if (error instanceof McpFailureError) return error.diagnostic;
  const aborted =
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError";
  return createMcpFailureDiagnostic({
    operation,
    code: aborted ? "TIMEOUT" : "CONNECTION_ERROR",
    reason: aborted
      ? `The integration timed out while running ${operation}.`
      : error instanceof Error
        ? error.message
        : `The integration connection failed while running ${operation}.`,
    requestWasSent: true,
  });
}

export function withMcpIntegration(
  diagnostic: McpFailureDiagnostic,
  integration: string,
): McpFailureDiagnostic {
  return createMcpFailureDiagnostic({
    ...diagnostic,
    integration,
    retrySafe: diagnostic.retry.safe,
    retryGuidance: diagnostic.retry.guidance,
    retryAfterSeconds: diagnostic.retry.afterSeconds,
  });
}

/** Keep the user-requested tool as the operation while retaining MCP stage context. */
export function withMcpOperation(
  diagnostic: McpFailureDiagnostic,
  operation: string,
): McpFailureDiagnostic {
  if (diagnostic.operation === operation) return diagnostic;
  return createMcpFailureDiagnostic({
    ...diagnostic,
    operation,
    stage: diagnostic.stage ?? diagnostic.operation,
    retrySafe: diagnostic.retry.safe,
    retryGuidance: diagnostic.retry.guidance,
    retryAfterSeconds: diagnostic.retry.afterSeconds,
  });
}

export function formatMcpFailureDiagnostic(
  diagnostic: McpFailureDiagnostic,
): string {
  return JSON.stringify({ ok: false, error: diagnostic });
}

/**
 * Whether a failure means "the stored credential no longer works" rather than
 * "something went wrong once".
 *
 * The distinction matters because only this kind is worth telling the user
 * about: a rate limit or a flaky server fixes itself, an expired grant never
 * does until someone signs in again. Anything else stays quiet.
 */
export function isAuthFailure(diagnostic: McpFailureDiagnostic): boolean {
  return (
    diagnostic.status === 401 ||
    diagnostic.status === 403 ||
    diagnostic.code === "UNAUTHORIZED" ||
    diagnostic.code === "FORBIDDEN"
  );
}

export class McpFailureError extends Error {
  readonly diagnostic: McpFailureDiagnostic;

  constructor(diagnostic: McpFailureDiagnostic) {
    super(diagnostic.reason);
    this.name = "McpFailureError";
    this.diagnostic = diagnostic;
  }
}
