import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { clientIpFrom, processWaitlistSubmission } from "./lib/waitlist";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer | string) => {
      body += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function waitlistApiDevPlugin(env: Record<string, string>): Plugin {
  return {
    name: "waitlist-api-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        "/api/waitlist",
        async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "Method not allowed" });
            return;
          }

          let parsed: { email?: unknown; companyWebsite?: unknown } = {};
          try {
            const raw = await readBody(req);
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            sendJson(res, 400, { error: "Invalid JSON" });
            return;
          }

          const ip =
            clientIpFrom(req.headers) ||
            req.socket.remoteAddress?.replace(/^::ffff:/, "") ||
            "";

          const result = await processWaitlistSubmission(
            parsed,
            {
              RESEND_API_KEY: env.RESEND_API_KEY ?? process.env.RESEND_API_KEY,
              RESEND_AUDIENCE_ID:
                env.RESEND_AUDIENCE_ID ?? process.env.RESEND_AUDIENCE_ID,
            },
            ip,
          );

          if (result.ok) {
            sendJson(res, 200, {
              ok: true,
              alreadySubscribed: result.alreadySubscribed ?? false,
            });
            return;
          }
          sendJson(res, result.status, { error: result.error });
        },
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss(), waitlistApiDevPlugin(env)],
  };
});
