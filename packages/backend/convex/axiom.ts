// Minimal Axiom ingest client for Convex's default runtime. Keeping this on
// fetch means actions and HTTP actions can emit operational telemetry without
// pulling Node-only logging packages into the inference path.

const AXIOM_TOKEN = process.env.AXIOM_TOKEN;
const AXIOM_DATASET = process.env.AXIOM_DATASET;
const AXIOM_HOST = (process.env.AXIOM_HOST ?? "https://api.axiom.co").replace(
  /\/$/,
  "",
);

type AxiomEventInput = {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
};

export const axiomEnabled = Boolean(AXIOM_TOKEN && AXIOM_DATASET);

export async function captureAxiomEvent({
  event,
  distinctId,
  properties,
}: AxiomEventInput): Promise<void> {
  if (!AXIOM_TOKEN || !AXIOM_DATASET) return;

  try {
    await fetch(
      `${AXIOM_HOST}/v1/datasets/${encodeURIComponent(AXIOM_DATASET)}/ingest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AXIOM_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          {
            ...properties,
            _time: new Date().toISOString(),
            event,
            distinct_id: distinctId,
            service: "whirl-convex",
            source: "convex",
          },
        ]),
      },
    );
  } catch {
    // Telemetry is best-effort and must never affect a user request.
  }
}
