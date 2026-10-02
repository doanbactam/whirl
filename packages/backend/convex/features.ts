import { query } from "./_generated/server";
import { isSupermemoryConfigured } from "./supermemory";

/* The optional services this deployment has configured, so the web app can
   hide the controls it can't honor instead of letting them fail. Whirl only
   needs Convex, Clerk and OpenRouter. Billing, web search, long-term memory
   and the support agent each switch on with their keys.

   Booleans only, never the keys. It reads nothing from the database, so it
   costs nothing and answers the same for everyone. */
export const get = query({
  args: {},
  handler: async () => ({
    billing: Boolean(process.env.AUTUMN_SECRET_KEY),
    search: Boolean(process.env.EXA_API_KEY),
    memory: isSupermemoryConfigured(),
  }),
});
