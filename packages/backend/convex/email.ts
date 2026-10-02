/**
 * Transactional email, sent straight through Resend's REST API. The same
 * `RESEND_API_KEY` the Clerk webhook uses for audience contacts (convex/clerk.ts)
 * — this is the other half of that account: `POST /emails` rather than
 * `POST /audiences/:id/contacts`.
 *
 * Plain `fetch`, so it stays in Convex's default runtime with no `"use node"`.
 * Nothing here throws: a send that fails comes back as `{ ok: false, error }`
 * with a message worth showing a human, because every caller so far wants to
 * record the failure next to whatever it was emailing about rather than
 * unwind the work that produced it.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type SendEmailResult = { ok: true; id: string | null } | {
  ok: false;
  error: string;
};

/** Pull Resend's human-readable message out of an error body, if there is one. */
function describeFailure(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string; name?: string };
    if (parsed.message) return parsed.message;
    if (parsed.name) return parsed.name;
  } catch {
    // Resend answers rate limits and gateway errors in plain text.
  }
  const trimmed = body.trim();
  return trimmed ? `${status}: ${trimmed.slice(0, 200)}` : `HTTP ${status}`;
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
}: {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Always send one — HTML-only mail scores as spam. */
  text: string;
  replyTo?: string;
}): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Email isn't configured (RESEND_API_KEY)." };
  }
  // A sender on a domain verified in your Resend account, e.g.
  // `npx convex env set RESEND_FROM_EMAIL "Whirl <hello@your-domain>"`.
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!from) {
    return {
      ok: false,
      error: "Email has no sender address (RESEND_FROM_EMAIL).",
    };
  }

  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: `Couldn't reach Resend: ${detail}` };
  }

  const body = await response.text();
  if (!response.ok) {
    return { ok: false, error: describeFailure(response.status, body) };
  }

  let id: string | null = null;
  try {
    id = (JSON.parse(body) as { id?: string }).id ?? null;
  } catch {
    // A 200 without a parseable body still means it's away.
  }
  return { ok: true, id };
}
