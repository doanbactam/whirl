import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";
import { Layout } from "./routes/__root";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    defaultNotFoundComponent: NotFound,
    scrollRestoration: true,
  });
}

function NotFound() {
  return (
    <Layout>
      <main className="flex min-h-dvh items-center justify-center bg-[#f8f8fa] px-4 py-10 text-neutral-900 dark:bg-[#171718] dark:text-neutral-50">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-[20px] font-medium tracking-tight">Not found</h1>
          <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
            The requested page could not be found.
          </p>
        </div>
      </main>
    </Layout>
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
