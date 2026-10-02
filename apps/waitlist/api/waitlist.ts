import { clientIpFrom, processWaitlistSubmission } from "../lib/waitlist";

export const config = { runtime: "edge" };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: { email?: unknown; companyWebsite?: unknown } = {};
  try {
    body = (await request.json()) as { email?: unknown; companyWebsite?: unknown };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const ip = clientIpFrom(request.headers);
  const result = await processWaitlistSubmission(
    body,
    {
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      RESEND_AUDIENCE_ID: process.env.RESEND_AUDIENCE_ID,
    },
    ip,
  );

  if (result.ok) {
    return json({ ok: true, alreadySubscribed: result.alreadySubscribed ?? false });
  }
  return json({ error: result.error }, result.status);
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
