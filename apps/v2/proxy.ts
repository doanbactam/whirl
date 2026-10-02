import { clerkMiddleware } from "@clerk/nextjs/server";
import { transformMiddlewareRequest } from "@axiomhq/nextjs";
import { NextResponse } from "next/server";

import { logger } from "@/lib/axiom/server";

// Next 16 renamed the middleware convention to proxy. Clerk still owns the
// auth handshake; Axiom observes the same request without changing it.
export default clerkMiddleware((_auth, request, event) => {
  if (request.nextUrl.pathname !== "/api/axiom") {
    logger.info(...transformMiddlewareRequest(request));
    event.waitUntil(logger.flush());
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
