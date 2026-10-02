import { httpAction } from "./_generated/server";
import { FUNNEL_EVENTS } from "./funnel";
import { captureServerEvent } from "./posthog";

// Constant-time comparison so signature checks don't leak via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Verifies a Clerk webhook, which is signed with Svix. The signing secret
 * (`whsec_…`) keys an HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`; the
 * resulting base64 digest must match one of the space-separated `v1,<sig>`
 * entries in the `svix-signature` header. Runs on Web Crypto so it stays in
 * Convex's default runtime (no Node).
 */
async function verifySvixSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
): Promise<boolean> {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  // Secrets are prefixed `whsec_`; the bytes after it are base64-encoded.
  const secretBytes = base64ToBytes(secret.replace(/^whsec_/, ""));
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  );
  const expected = bytesToBase64(new Uint8Array(mac));

  // Header looks like "v1,<sig> v2,<sig> …" — any matching v1 entry passes.
  return signatureHeader
    .split(" ")
    .map((entry) => entry.split(",")[1])
    .some((sig) => sig && timingSafeEqual(sig, expected));
}

type ClerkUserEvent = {
  type: string;
  data: {
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    email_addresses?: Array<{
      id: string;
      email_address: string;
    }>;
    primary_email_address_id?: string | null;
  };
};

function primaryEmail(data: ClerkUserEvent["data"]): string | null {
  const emails = data.email_addresses ?? [];
  if (emails.length === 0) return null;
  const primary = emails.find((e) => e.id === data.primary_email_address_id);
  return (primary ?? emails[0]).email_address;
}

/**
 * Creates (or upserts) a contact in a Resend audience. Resend treats a POST for
 * an already-existing email as a success, so this is safe to call on repeated
 * `user.created` deliveries.
 */
async function createResendContact(input: {
  apiKey: string;
  audienceId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(
    `https://api.resend.com/audiences/${input.audienceId}/contacts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        first_name: input.firstName ?? undefined,
        last_name: input.lastName ?? undefined,
        unsubscribed: false,
      }),
    },
  );
  return { ok: res.ok, status: res.status };
}

/**
 * Clerk webhook → Resend contact sync. On a `user.created` event we add the new
 * user to the configured Resend audience. Mounted at `/api/clerk-webhook` in
 * http.ts. Returns 200 for events we intentionally ignore so Clerk doesn't
 * retry them.
 */
export const clerkWebhook = httpAction(async (_ctx, req) => {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  const resendApiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!secret || !resendApiKey || !audienceId) {
    return new Response("Webhook not configured", { status: 500 });
  }

  const raw = await req.text();
  const valid = await verifySvixSignature(raw, req.headers, secret);
  if (!valid) {
    return new Response("Invalid signature", { status: 401 });
  }

  let event: ClerkUserEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Only react to new sign-ups; ack everything else without acting on it.
  if (event.type !== "user.created") {
    return new Response("ignored", { status: 200 });
  }

  // Funnel step 2 (W-155). Clerk tells us about every new account, however it
  // was made — the sign-up panel only sees the email/password path finish, since
  // Google sends people off to an SSO round trip and back to a fresh page. The
  // panel captures this too; PostHog folds the pair together by distinct id.
  await captureServerEvent({
    event: FUNNEL_EVENTS.signupCompleted,
    distinctId: event.data.id,
    properties: { source: "clerk_webhook" },
  });

  const email = primaryEmail(event.data);
  if (!email) {
    return new Response("No email on user", { status: 200 });
  }

  const result = await createResendContact({
    apiKey: resendApiKey,
    audienceId,
    email,
    firstName: event.data.first_name,
    lastName: event.data.last_name,
  });

  await captureServerEvent({
    event: "resend_contact_synced",
    distinctId: event.data.id,
    properties: {
      source: "clerk_webhook",
      resend_status: result.status,
      success: result.ok,
    },
  });

  if (!result.ok) {
    return new Response("Failed to create Resend contact", { status: 502 });
  }
  return new Response("ok", { status: 200 });
});
