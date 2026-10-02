import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Every var, not just VITE_ ones: the dev hosts below never reach the
  // browser bundle.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), tailwindcss()],
    // Fixed port so Clerk's dev instance and muscle memory both know where the
    // console lives (the main app takes 3000).
    server: {
      port: 3001,
      strictPort: true,
      // Extra hosts allowed to reach the dev server (a proxy, another
      // device), comma-separated in DEV_ALLOWED_ORIGINS.
      allowedHosts: (env.DEV_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((host) => host.trim())
        .filter(Boolean),
    },
    resolve: {
      alias: {
        "~": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  };
});
