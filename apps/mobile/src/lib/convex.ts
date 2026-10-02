import { ConvexReactClient } from "convex/react";
import {
  anyApi,
  type DefaultFunctionArgs,
  type FunctionReference,
} from "convex/server";

import type { ThreadSummary } from "@/lib/threads";

/**
 * The app's slice of the Convex API.
 *
 * The web apps import the generated bindings from `@whirl/backend`, which
 * carries the whole backend's types with it. Metro is deliberately pointed at
 * this app's own root plus the hoisted `node_modules` and nothing else (see
 * metro.config.js — widening the crawl ran the bundler out of file handles),
 * and the backend is built against a different TypeScript than this app pins,
 * so pulling that package in costs more than it pays for.
 *
 * Instead the references are looked up by name — `anyApi` is exactly that, a
 * proxy that turns a path into a function reference — and given the types the
 * mobile app needs by hand below. The shapes are the ones `convex/threads.ts`
 * actually returns; keep them in step with it.
 */

type Query<Args extends DefaultFunctionArgs, Return> = FunctionReference<
  "query",
  "public",
  Args,
  Return
>;
type Mutation<Args extends DefaultFunctionArgs, Return> = FunctionReference<
  "mutation",
  "public",
  Args,
  Return
>;

/** Convex ids are strings on the wire; the branding only exists backend-side. */
export type ThreadId = string;

export const api = {
  threads: {
    listForCurrentUser: anyApi.threads.listForCurrentUser as Query<
      Record<string, never>,
      ThreadSummary[]
    >,
    updateThread: anyApi.threads.updateThread as Mutation<
      { threadId: ThreadId; title: string },
      null
    >,
    regenerateTitle: anyApi.threads.regenerateTitle as Mutation<
      { threadId: ThreadId },
      null
    >,
    setPinned: anyApi.threads.setPinned as Mutation<
      { threadId: ThreadId; pinned: boolean },
      null
    >,
    deleteThread: anyApi.threads.deleteThread as Mutation<
      { threadId: ThreadId },
      null
    >,
    shareThread: anyApi.threads.shareThread as Mutation<
      { threadId: ThreadId },
      { shareId: string }
    >,
    unshareThread: anyApi.threads.unshareThread as Mutation<
      { threadId: ThreadId },
      null
    >,
  },
} as const;

/** Where whirl is served — the origin every share link is built against.
 *  Set EXPO_PUBLIC_SITE_URL to your web app's public address. */
export const WHIRL_ORIGIN = (
  process.env.EXPO_PUBLIC_SITE_URL || "http://localhost:3000"
).replace(/\/+$/, "");

export const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

/**
 * One client for the process, built lazily so a missing URL surfaces as the
 * setup notice rather than as a crash on the first import.
 *
 * `unsavedChangesWarning` is a browser-only guard that reaches for `window`;
 * there isn't one here, and there's no tab to close either way.
 */
export function createConvexClient(url: string) {
  return new ConvexReactClient(url, { unsavedChangesWarning: false });
}
