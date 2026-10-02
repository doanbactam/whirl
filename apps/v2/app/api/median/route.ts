/* Median's one door into Whirl.
 *
 *   bearer   GET  connects this URL and syncs the manifest. Since 0.3 it
 *                 needs `Authorization: Bearer $MEDIAN_KEY`; a bare GET is 401
 *   signed   GET  hands back the manifest
 *   signed   POST runs a tool
 *
 * The signature covers the exact bytes of the body, so nothing may read it
 * first. Next hands a real Request straight through, which is why this file is
 * two lines and the config next door is the interesting one. */

import { median } from "@mediansh/agent-tools";

import config from "@/median.config";

/* The config reaches Convex through ConvexHttpClient, so this route wants the
   Node runtime rather than the edge. */
export const runtime = "nodejs";

export const { GET, POST } = median(config);
