import "server-only";

import { Axiom } from "@axiomhq/js";
import {
  AxiomJSTransport,
  ConsoleTransport,
  Logger,
  type Transport,
} from "@axiomhq/logging";
import {
  createAxiomRouteHandler,
  nextJsFormatters,
} from "@axiomhq/nextjs";

const token = process.env.AXIOM_TOKEN;
const dataset = process.env.AXIOM_DATASET;

function createTransport(): Transport {
  if (!token || !dataset) {
    // Analytics is optional for local contributors. Keep every Axiom call
    // safe while dropping events quietly when credentials are absent.
    return new ConsoleTransport({ logLevel: "off" });
  }

  return new AxiomJSTransport({
    axiom: new Axiom({ token }),
    dataset,
    axiomClient: "whirl-v2",
  });
}

export const logger = new Logger({
  transports: [createTransport()],
  formatters: nextJsFormatters,
});

export const withAxiom = createAxiomRouteHandler(logger);
