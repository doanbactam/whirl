/* The Kirkify page's only door.
 *
 * Everything the budget depends on is decided here, on the server, before
 * Convex hears about the request: the visitor's IP (hashed), the device
 * cookie, the Clerk session, and BotID's verdict. Convex then does the
 * counting and the swap (convex/kirkify.ts) and trusts this route because
 * it presents KIRKIFY_SECRET.
 *
 * Nothing here is cacheable, and every response re-sets the device cookie
 * so it never lapses on a returning visitor. */

import { auth } from "@clerk/nextjs/server";
import { api } from "@whirl/backend/convex/_generated/api";
import { checkBotId } from "botid/server";
import { ConvexHttpClient } from "convex/browser";
import { NextResponse, type NextRequest } from "next/server";

import {
  clientIp,
  hashIp,
  keepDeviceCookie,
  readDeviceId,
} from "@/lib/kirkify/visitor";
import type {
  KirkifyFailure,
  KirkifyFailureCode,
  KirkifyQuota,
  KirkifyResponse,
} from "@/lib/kirkify/types";

export const runtime = "nodejs";
/* A swap on the pro model runs about a minute, and the action may try
   once more if the model paints nothing. The ceiling has to outlast both,
   or the route dies while the swap finishes and spends its slot unseen. */
export const maxDuration = 300;

const STATUS_FOR: Record<KirkifyFailureCode, number> = {
  quota: 429,
  capacity: 503,
  invalid_image: 400,
  provider: 502,
  declined: 422,
  config: 500,
  bot: 403,
  network: 502,
};

const NOT_CONFIGURED: KirkifyFailure = {
  ok: false,
  code: "config",
  message: "Kirkify isn't set up on this deployment yet.",
  counted: false,
  remaining: null,
};

function failure(
  code: KirkifyFailureCode,
  message: string,
): NextResponse<KirkifyFailure> {
  return NextResponse.json(
    { ok: false, code, message, counted: false, remaining: null },
    { status: STATUS_FOR[code] },
  );
}

function backend(): { convex: ConvexHttpClient; secret: string } | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.KIRKIFY_SECRET;
  if (!convexUrl || !secret) {
    console.error("kirkify: NEXT_PUBLIC_CONVEX_URL or KIRKIFY_SECRET is unset");
    return null;
  }
  return { convex: new ConvexHttpClient(convexUrl), secret };
}

/**
 * The photo's pixel size, when the page sent a sane one. It only picks the
 * output's aspect ratio, so a lie here buys nothing.
 */
function pixelSize(
  width: unknown,
  height: unknown,
): { width: number; height: number } | Record<never, never> {
  const sane = (n: unknown): n is number =>
    typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 8192;
  return sane(width) && sane(height) ? { width, height } : {};
}

async function identify(request: NextRequest, secret: string) {
  const { userId } = await auth();
  return {
    ipHash: hashIp(clientIp(request.headers), secret),
    deviceId: readDeviceId(request),
    ...(userId ? { userId } : {}),
  };
}

export async function GET(request: NextRequest) {
  const server = backend();
  if (!server) {
    return NextResponse.json(NOT_CONFIGURED, { status: 500 });
  }
  const visitor = await identify(request, server.secret);

  let quota: KirkifyQuota;
  try {
    quota = await server.convex.action(api.kirkify.quota, {
      secret: server.secret,
      ...visitor,
    });
  } catch (error) {
    console.error(
      "kirkify: quota lookup failed",
      error instanceof Error ? error.message : error,
    );
    return failure("network", "Couldn't read today's count.");
  }

  const response = NextResponse.json(quota, {
    headers: { "cache-control": "private, no-store" },
  });
  keepDeviceCookie(response, visitor.deviceId);
  return response;
}

export async function POST(request: NextRequest) {
  const server = backend();
  if (!server) {
    return NextResponse.json(NOT_CONFIGURED, { status: 500 });
  }

  /* First, before the body is even read: a script never gets as far as
     spending a slot. Local development always passes. */
  const verdict = await checkBotId();
  if (verdict.isBot) {
    return failure(
      "bot",
      "That request didn't look like it came from a browser.",
    );
  }

  const body = (await request.json().catch(() => null)) as {
    image?: unknown;
    width?: unknown;
    height?: unknown;
  } | null;
  const image = typeof body?.image === "string" ? body.image : null;
  if (!image) {
    return failure("invalid_image", "Send a photo as a JPG, PNG or WebP.");
  }

  const visitor = await identify(request, server.secret);

  let outcome: KirkifyResponse;
  try {
    outcome = await server.convex.action(api.kirkify.generate, {
      secret: server.secret,
      ...visitor,
      image,
      ...pixelSize(body?.width, body?.height),
    });
  } catch (error) {
    /* The action itself threw: a bad secret, a Convex outage. Not the
       provider, and not the visitor's fault. */
    console.error(
      "kirkify: generate failed",
      error instanceof Error ? error.message : error,
    );
    return failure(
      "network",
      "Whirl couldn't run that swap. Try again in a moment.",
    );
  }

  const response = NextResponse.json(outcome, {
    status: outcome.ok ? 200 : STATUS_FOR[outcome.code],
    headers: { "cache-control": "private, no-store" },
  });
  keepDeviceCookie(response, visitor.deviceId);
  return response;
}
