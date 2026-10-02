import { expect, test } from "bun:test";
import { ConvexError } from "convex/values";

import { isAdminIdentity, requireAdmin } from "../convex/admin";

type AdminContext = Parameters<typeof isAdminIdentity>[0];

function contextFor(identity: Record<string, unknown> | null): AdminContext {
  return {
    auth: {
      getUserIdentity: async () => identity,
    },
  } as unknown as AdminContext;
}

test("admin identity requires an authenticated admin role claim", async () => {
  expect(await isAdminIdentity(contextFor(null))).toBe(false);
  expect(
    await isAdminIdentity(
      contextFor({ tokenIdentifier: "user:member", role: "member" }),
    ),
  ).toBe(false);
  expect(
    await isAdminIdentity(
      contextFor({ tokenIdentifier: "user:admin", role: "admin" }),
    ),
  ).toBe(true);
  expect(
    await isAdminIdentity(
      contextFor({
        tokenIdentifier: "user:nested-admin",
        publicMetadata: { role: "admin" },
      }),
    ),
  ).toBe(true);
});

test("admin assertion rejects unauthorized callers with a safe client error", async () => {
  try {
    await requireAdmin(
      contextFor({ tokenIdentifier: "user:member", role: "member" }),
    );
    throw new Error("Expected requireAdmin to reject a non-admin");
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    expect((error as ConvexError<string>).data).toBe("Admin access required");
  }
});

test("admin assertion accepts an authenticated admin", async () => {
  await expect(
    requireAdmin(
      contextFor({ tokenIdentifier: "user:admin", role: "admin" }),
    ),
  ).resolves.toBeUndefined();
});
