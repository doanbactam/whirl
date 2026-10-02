"use client";

import { Logger, ProxyTransport } from "@axiomhq/logging";
import { nextJsFormatters } from "@axiomhq/nextjs/client";

export const logger = new Logger({
  transports: [
    new ProxyTransport({
      url: "/api/axiom",
      autoFlush: true,
    }),
  ],
  formatters: nextJsFormatters,
});
