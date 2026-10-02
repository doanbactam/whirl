import { Autumn, type Customer } from "autumn-js";
import { ConvexError } from "convex/values";

export function slotBillingClient() {
  const secretKey = process.env.AUTUMN_SECRET_KEY;
  if (!secretKey)
    throw new ConvexError(
      "The token arcade is temporarily unavailable. Please try again later.",
    );
  return new Autumn({ secretKey });
}

export async function readSlotCustomer(autumn: Autumn, customerId: string) {
  const { data, error } = await autumn.customers.get(customerId);
  if (error || !data)
    throw new ConvexError(
      "We couldn’t check your plan. Open Whirl chat once to set up your account, then try again.",
    );
  return data;
}

export class UnconfirmedPlanGrant extends Error {}

/**
 * Use the documented REST endpoint: the pinned SDK predates ends_at.
 * A free custom price + no billing changes + a hard end prevent renewals/charges.
 * Existing paid plans are checked immediately before calling this helper.
 * https://docs.useautumn.com/api-reference/billing/attach
 */
export async function grantPlan(
  customerId: string,
  plan: string,
  expiresAt: number,
) {
  let response: Response;
  try {
    response = await fetch("https://api.useautumn.com/v1/billing.attach", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AUTUMN_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer_id: customerId,
        plan_id: plan,
        customize: { price: null, free_trial: null },
        ends_at: expiresAt,
        no_billing_changes: true,
        redirect_mode: "never",
        plan_schedule: "immediate",
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new UnconfirmedPlanGrant(
      "Billing did not confirm this pass. Contact support with your prize ID; your prize is saved.",
    );
  }
  if (!response.ok) {
    // A provider 5xx may come after the grant was written. Never auto-replay it.
    if (response.status >= 500)
      throw new UnconfirmedPlanGrant(
        "Billing did not confirm this pass. Contact support with your prize ID; your prize is saved.",
      );
    throw new ConvexError(
      "Billing could not activate the pass. Your prize is saved; please try again later.",
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new UnconfirmedPlanGrant(
      "Billing returned an incomplete confirmation. Contact support with your prize ID.",
    );
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("customer_id" in body) ||
    body.customer_id !== customerId ||
    !("payment_url" in body) ||
    body.payment_url !== null
  ) {
    throw new UnconfirmedPlanGrant(
      "Billing returned an incomplete confirmation. Contact support with your prize ID.",
    );
  }
}
