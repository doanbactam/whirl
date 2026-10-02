import { expect, test } from "bun:test";

import {
  createMcpFailureDiagnostic,
  diagnosticFromHttpResponse,
  diagnosticFromMcpPayload,
  diagnosticFromThrownError,
  formatMcpFailureDiagnostic,
  McpFailureError,
} from "../convex/inference/mcpDiagnostics";
import {
  createMcpGatewayTools,
  MCP_CALL_TOOL_NAME,
  mcpCallTool,
} from "../convex/inference/mcp";

test("extracts actionable Google-style permission diagnostics", async () => {
  const response = new Response(
    JSON.stringify({
      error: {
        code: 403,
        status: "PERMISSION_DENIED",
        message: "Caller cannot edit spreadsheet myface.",
        details: [
          {
            fieldViolations: [
              {
                field: "spreadsheetId",
                description: "The connected account does not have write access.",
              },
            ],
          },
        ],
      },
    }),
    {
      status: 403,
      headers: { "x-request-id": "sheets-request-42" },
    },
  );

  const diagnostic = await diagnosticFromHttpResponse(
    "GOOGLESHEETS_UPDATE_RANGE",
    response,
  );

  expect(diagnostic).toMatchObject({
    operation: "GOOGLESHEETS_UPDATE_RANGE",
    status: 403,
    code: "PERMISSION_DENIED",
    reason: "Caller cannot edit spreadsheet myface.",
    requestId: "sheets-request-42",
    retry: { safe: false },
  });
  expect(diagnostic.retry.guidance).toContain("permissions");
  expect(diagnostic.validationDetails).toContainEqual({
    field: "spreadsheetId",
    message: "The connected account does not have write access.",
  });
});

test("preserves Linear-style validation details and semantic codes", () => {
  const diagnostic = diagnosticFromMcpPayload("issue_update", {
    isError: true,
    structuredContent: {
      errors: [
        {
          message: "Title cannot be empty.",
          path: "input.title",
          extensions: {
            code: "BAD_USER_INPUT",
            requestId: "linear-request-7",
          },
        },
      ],
    },
  });

  expect(diagnostic).toMatchObject({
    operation: "issue_update",
    code: "BAD_USER_INPUT",
    reason: "Title cannot be empty.",
    requestId: "linear-request-7",
    retry: { safe: false },
  });
  expect(diagnostic.validationDetails).toContainEqual({
    field: "input.title",
    message: "Title cannot be empty.",
  });
});

test("uses HTTP retry policy after parsing provider payloads", async () => {
  const rateLimit = await diagnosticFromHttpResponse(
    "search_records",
    new Response(
      JSON.stringify({ error: { message: "Too many requests." } }),
      {
        status: 429,
        headers: { "retry-after": "12" },
      },
    ),
  );
  expect(rateLimit.retry).toEqual({
    safe: true,
    guidance: "Retry after the provider's rate-limit window.",
    afterSeconds: 12,
  });

  const forbidden = await diagnosticFromHttpResponse(
    "update_record",
    new Response(
      JSON.stringify({ error: { message: "Access is forbidden." } }),
      { status: 403 },
    ),
  );
  expect(forbidden.retry.safe).toBe(false);
  expect(forbidden.retry.guidance).toContain("permissions");
});

test("returns a useful generic fallback for bare MCP failures", () => {
  const diagnostic = diagnosticFromMcpPayload(
    "custom_write",
    { isError: true, content: [{ type: "text", text: "failed" }] },
    "failed",
  );
  const formatted = JSON.parse(formatMcpFailureDiagnostic(diagnostic));

  expect(formatted).toEqual({
    ok: false,
    error: expect.objectContaining({
      operation: "custom_write",
      reason:
        "The integration reported that custom_write failed without a specific reason.",
      retry: expect.objectContaining({ safe: false }),
    }),
  });
});

test("redacts credentials and marks uncertain transport failures unsafe", () => {
  const diagnostic = diagnosticFromThrownError(
    "create_record",
    new Error(
      "Connector failed with Authorization: Bearer secret-token-value and api_key=do-not-leak",
    ),
  );

  expect(diagnostic.code).toBe("CONNECTION_ERROR");
  expect(diagnostic.reason).not.toContain("secret-token-value");
  expect(diagnostic.reason).not.toContain("do-not-leak");
  expect(diagnostic.retry.safe).toBe(false);
  expect(diagnostic.retry.guidance).toContain("avoid duplicates");
});

test("local validation failures are safe after correction", () => {
  const diagnostic = createMcpFailureDiagnostic({
    operation: "custom_write",
    code: "INVALID_ARGUMENTS",
    reason: "`arguments` must be valid JSON.",
    validationDetails: [
      { field: "arguments", message: "Expected a JSON object." },
    ],
    requestWasSent: false,
  });

  expect(diagnostic.retry.safe).toBe(true);
  expect(diagnostic.validationDetails).toEqual([
    { field: "arguments", message: "Expected a JSON object." },
  ]);
});

test("the gateway structures malformed arguments and missing integrations", async () => {
  const results: { server: string; tool: string; error?: string }[] = [];
  const gateway = createMcpGatewayTools({
    resolveServers: async () => [
      {
        name: "Custom CRM",
        url: "https://example.com/mcp",
        headers: [],
      },
    ],
    onToolsListed: async () => {},
    onToolsListResult: async () => {},
    onToolResult: async (result) => {
      results.push(result);
    },
  });
  const execute = gateway.tools[MCP_CALL_TOOL_NAME].execute as (
    input: {
      integration: string;
      tool: string;
      arguments?: string;
    },
  ) => Promise<string>;

  const malformed = JSON.parse(
    await execute({
      integration: "Custom CRM",
      tool: "create_contact",
      arguments: "{",
    }),
  );
  expect(malformed.error).toMatchObject({
    operation: "create_contact",
    integration: "Custom CRM",
    code: "INVALID_ARGUMENTS",
    retry: { safe: true },
  });
  expect(malformed.error.validationDetails).toContainEqual({
    field: "arguments",
    message: "Expected a JSON-encoded object.",
  });

  const missing = JSON.parse(
    await execute({
      integration: "Missing CRM",
      tool: "create_contact",
    }),
  );
  expect(missing.error).toMatchObject({
    operation: "create_contact",
    integration: "Missing CRM",
    code: "INTEGRATION_NOT_CONNECTED",
    retry: { safe: true },
  });
  expect(results).toHaveLength(2);
});

test("mcpCallTool turns JSON-RPC failures into structured diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
    new Response(null, { status: 202 }),
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        error: {
          code: -32602,
          message: "Invalid tool arguments.",
          data: {
            requestId: "rpc-request-9",
            fieldViolations: [
              { field: "range", description: "Range must use A1 notation." },
            ],
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ];
  globalThis.fetch = (async () => responses.shift()!) as typeof fetch;

  try {
    await mcpCallTool(
      "https://example.com/mcp",
      [],
      "GOOGLESHEETS_UPDATE_RANGE",
      { range: "bad" },
    );
    throw new Error("Expected mcpCallTool to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(McpFailureError);
    expect((error as McpFailureError).diagnostic).toMatchObject({
      operation: "GOOGLESHEETS_UPDATE_RANGE",
      code: "-32602",
      reason: "Invalid tool arguments.",
      requestId: "rpc-request-9",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mcpCallTool structures MCP isError result payloads", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
    new Response(null, { status: 202 }),
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        result: {
          isError: true,
          structuredContent: {
            error: {
              status: "INVALID_ARGUMENT",
              message: "Spreadsheet range is invalid.",
              requestId: "sheets-result-3",
            },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ];
  globalThis.fetch = (async () => responses.shift()!) as typeof fetch;

  try {
    const result = await mcpCallTool(
      "https://example.com/mcp",
      [],
      "GOOGLESHEETS_BATCH_UPDATE",
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.failure).toMatchObject({
      operation: "GOOGLESHEETS_BATCH_UPDATE",
      code: "INVALID_ARGUMENT",
      reason: "Spreadsheet range is invalid.",
      requestId: "sheets-result-3",
    });
    expect(JSON.parse(result.text).ok).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mcpCallTool keeps the requested operation when initialization fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: {
          status: "PERMISSION_DENIED",
          message: "The connector grant has expired.",
        },
      }),
      { status: 403, headers: { "x-request-id": "init-request-2" } },
    )) as typeof fetch;

  try {
    await mcpCallTool(
      "https://example.com/mcp",
      [],
      "issue_update",
      {},
    );
    throw new Error("Expected mcpCallTool to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(McpFailureError);
    expect((error as McpFailureError).diagnostic).toMatchObject({
      operation: "issue_update",
      stage: "initialize",
      status: 403,
      code: "PERMISSION_DENIED",
      requestId: "init-request-2",
      retry: { safe: false },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
