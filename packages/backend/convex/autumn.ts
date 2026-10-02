import { Autumn } from "@useautumn/convex";

import { components } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";

export const autumn = new Autumn(components.autumn, {
  secretKey: process.env.AUTUMN_SECRET_KEY ?? "",
  identify: async (ctx: Pick<ActionCtx, "auth">) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    // Keep the existing Autumn customer key. Changing this to tokenIdentifier
    // would create a second billing customer for every current user.
    return {
      customerId: identity.subject,
      customerData: {
        email: typeof identity.email === "string" ? identity.email : undefined,
        name: typeof identity.name === "string" ? identity.name : undefined,
      },
    };
  },
});

// The React app only uses these operations. Keeping track/check/usage and the
// entity/referral/event APIs unexported both shrinks the Convex function list
// and prevents browsers from writing usage directly. Server-side metering stays
// on the direct Autumn SDK path used by the inference workers.
const clientApi = autumn.api();

export const createCustomer = clientApi.createCustomer;
export const attach = clientApi.attach;
export const checkout = clientApi.checkout;
export const cancel = clientApi.cancel;
export const billingPortal = clientApi.billingPortal;
export const listProducts = clientApi.listProducts;
