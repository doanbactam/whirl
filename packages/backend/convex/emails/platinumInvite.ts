/**
 * The email an approved Platinum request gets: the mark, a line, and the
 * checkout link minted for that customer. Deliberately hand-written HTML with
 * inline styles — mail clients strip <style> blocks and know nothing of our
 * tokens, so nothing here can lean on the app's CSS.
 *
 * The logo is a PNG, not the SVG the app uses: Gmail and Outlook both refuse
 * to render SVG in a message body. See apps/v2/scripts/render-email-logo.mjs.
 */

export function platinumInviteSubject(planName: string): string {
  return `Your invitation to ${planName}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "Ada" from "Ada Lovelace" — a first name reads warmer than a full one. */
function greetingName(name: string | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? `${first}, your` : "Your";
}

export function platinumInviteHtml({
  planName,
  checkoutUrl,
  name,
  logoUrl,
}: {
  planName: string;
  checkoutUrl: string;
  name?: string;
  /** Absolute URL — a relative src can't resolve inside a mail client. */
  logoUrl: string;
}): string {
  const plan = escapeHtml(planName);
  const url = escapeHtml(checkoutUrl);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f3f3f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#141414;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:20px;">
      <tr>
        <td style="padding:32px;">
          <img src="${escapeHtml(logoUrl)}" width="30" height="30" alt="Whirl" style="display:block;border:0;outline:none;text-decoration:none;" />
          <h1 style="margin:22px 0 12px;font-size:22px;font-weight:600;letter-spacing:-0.02em;">A place is available.</h1>
          <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#3f3f3f;">
            ${escapeHtml(greetingName(name))} request for ${plan} has been
            approved. This link is issued to your account — please don't
            forward it.
          </p>
          <a href="${url}" style="display:inline-block;padding:13px 22px;background:#141414;color:#ffffff;border-radius:999px;font-size:14px;font-weight:600;text-decoration:none;">
            Complete checkout
          </a>
          <p style="margin:28px 0 0;font-size:12.5px;line-height:1.6;color:#8a8a8a;">
            Nothing is charged until you complete checkout.<br />
            <span style="color:#a5a5a5;word-break:break-all;">${url}</span>
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function platinumInviteText({
  planName,
  checkoutUrl,
  name,
}: {
  planName: string;
  checkoutUrl: string;
  name?: string;
}): string {
  return [
    "A place is available.",
    "",
    `${greetingName(name)} request for ${planName} has been approved. This link is issued to your account — please don't forward it.`,
    "",
    checkoutUrl,
    "",
    "Nothing is charged until you complete checkout.",
    "",
    "— Whirl",
  ].join("\n");
}
