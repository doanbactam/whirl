"use client";

import {
  createUseLogger,
  createWebVitalsComponent,
} from "@axiomhq/react";
import { logger } from "./browser";

export { logger };
export const useLogger = createUseLogger(logger);
export const WebVitals = createWebVitalsComponent(logger);
