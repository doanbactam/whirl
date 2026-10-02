import { captureAxiomEvent } from "./axiom";
import { captureServerEvent } from "./posthog";

type PerformanceOutcome = "complete" | "error" | "stopped";

type BackendPerformanceInput = {
  operation: string;
  outcome: PerformanceOutcome;
  durationMs: number;
  distinctId: string;
  properties?: Record<string, unknown>;
};

export async function captureBackendPerformance({
  operation,
  outcome,
  durationMs,
  distinctId,
  properties,
}: BackendPerformanceInput): Promise<void> {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;

  const fields = {
    ...properties,
    operation,
    outcome,
    duration_ms: Math.round(durationMs * 100) / 100,
  };

  await Promise.all([
    captureServerEvent({
      event: "backend_performance",
      distinctId,
      properties: fields,
    }),
    captureAxiomEvent({
      event: "backend_performance",
      distinctId,
      properties: fields,
    }),
  ]);
}
