import {
  KIRKIFY_ENDPOINT,
  type KirkifyFailureCode,
  type KirkifyQuota,
  type KirkifyRemaining,
  type KirkifyResponse,
  type KirkifySuccess,
} from "./types";

/** A refusal the page can explain: what happened, and whether it cost a slot. */
export class KirkifyError extends Error {
  readonly code: KirkifyFailureCode;
  readonly counted: boolean;
  readonly remaining: KirkifyRemaining | null;

  constructor(
    code: KirkifyFailureCode,
    message: string,
    counted: boolean,
    remaining: KirkifyRemaining | null,
  ) {
    super(message);
    this.code = code;
    this.counted = counted;
    this.remaining = remaining;
  }
}

const OFFLINE_MESSAGE =
  "Couldn't reach Whirl. Check your connection and try again.";
const GARBLED_MESSAGE =
  "Whirl answered with something unexpected. Try again in a moment.";
const TOO_LARGE_MESSAGE = "That photo is too big to send. Try a smaller one.";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isKirkifyResponse(body: unknown): body is KirkifyResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { ok?: unknown }).ok === "boolean"
  );
}

export async function fetchKirkifyQuota(): Promise<KirkifyQuota> {
  const response = await fetch(KIRKIFY_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = await readJson(response);
  const known =
    response.ok &&
    typeof body === "object" &&
    body !== null &&
    "remaining" in body;
  if (!known) throw new Error(`quota unavailable (${response.status})`);
  return body as KirkifyQuota;
}

/** One swap. Resolves with the picture, or throws a KirkifyError. */
export async function requestKirkify(photo: {
  dataUrl: string;
  width: number;
  height: number;
}): Promise<KirkifySuccess> {
  let response: Response;
  try {
    response = await fetch(KIRKIFY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: photo.dataUrl,
        width: photo.width,
        height: photo.height,
      }),
      credentials: "same-origin",
    });
  } catch {
    throw new KirkifyError("network", OFFLINE_MESSAGE, false, null);
  }

  const body = await readJson(response);
  if (!isKirkifyResponse(body)) {
    /* A 413 from the platform or a 504 timeout page: nothing this page
       wrote, so nothing this page can explain beyond the status. */
    throw new KirkifyError(
      "network",
      response.status === 413 ? TOO_LARGE_MESSAGE : GARBLED_MESSAGE,
      false,
      null,
    );
  }
  if (!body.ok) {
    throw new KirkifyError(body.code, body.message, body.counted, body.remaining);
  }
  return body;
}
