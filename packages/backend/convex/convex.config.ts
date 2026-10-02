import { defineApp } from "convex/server";
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/convex.config.js";
import autumn from "@useautumn/convex/convex.config.js";

const app = defineApp();
app.use(persistentTextStreaming);
app.use(autumn);

export default app;
