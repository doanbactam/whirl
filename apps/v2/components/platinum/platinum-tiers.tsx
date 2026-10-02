"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { api } from "@whirl/backend/convex/_generated/api";
import { useCustomer } from "autumn-js/react";
import { useMutation, useQuery } from "convex/react";

import { AuthModal } from "@/components/auth/auth-modal";
import { captureCheckoutStarted } from "@/lib/funnel";
import { errorText } from "@/lib/integrations-data";
import { findActivePlanProduct, type PlatinumPlanId } from "@/lib/plan";
import { showToast } from "@/lib/toasts";
import { PLATINUM_TIERS, type PlatinumTier } from "./platinum-catalog";
import { PlatinumTierCard, type TierAction } from "./platinum-tier-card";

type MyInterest = {
  plan: PlatinumPlanId;
  status: "pending" | "approved" | "declined";
  checkoutUrl: string | null;
};

/**
 * The two Platinum cards and everything behind their buttons.
 *
 * Which button you get depends on three things: whether Platinum is open for
 * purchase (an admin's switch), whether you already have it, and whether
 * you've asked for it before. A declined request deliberately reads the same
 * as never having asked — we're not going to put "you were turned down" on
 * someone's screen forever, and letting them ask again costs us nothing.
 *
 * Requesting a place is one click. We don't ask why you want it: at this
 * price the question is beneath the customer, and the answer was never going
 * to decide anything.
 */
export function PlatinumTiers() {
  const { user, isLoaded: userLoaded } = useUser();
  const availability = useQuery(api.platinum.availability);
  const interest = useQuery(
    api.platinum.myInterest,
    user ? {} : "skip",
  ) as MyInterest | null | undefined;
  const expressInterest = useMutation(api.platinum.expressInterest);
  const { customer, checkout } = useCustomer();

  const [busyTier, setBusyTier] = useState<PlatinumPlanId | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  const activePlanId = user ? (findActivePlanProduct(customer)?.id ?? null) : null;
  // Signed-out visitors have no interest row to wait on, so availability
  // alone decides whether the buttons can settle.
  const settled =
    userLoaded &&
    availability !== undefined &&
    (!user || interest !== undefined);

  const startCheckout = async (tier: PlatinumTier) => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    setBusyTier(tier.id);
    try {
      const result = await checkout({ productId: tier.id });
      const url = (result as { data?: { url?: string | null } })?.data?.url;
      if (url) {
        // Captured before the handoff — after `assign` there's no telling how
        // much of this document still exists.
        captureCheckoutStarted(tier.id, "stripe");
        window.location.assign(url);
        return;
      }
      showToast(`${tier.name} is unavailable right now. Please try again shortly.`);
    } catch {
      showToast("We couldn't start checkout. Please try again.");
    } finally {
      setBusyTier(null);
    }
  };

  const requestInvitation = async (tier: PlatinumTier) => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    setBusyTier(tier.id);
    try {
      await expressInterest({ plan: tier.id });
      showToast("Request received. We'll be in touch by email.");
    } catch (error) {
      showToast(
        errorText(
          error,
          "We couldn't submit that request. Please try again in a moment.",
        ),
      );
    } finally {
      setBusyTier(null);
    }
  };

  const actionFor = (tier: PlatinumTier): TierAction | null => {
    if (!settled) return null;

    const busy = busyTier === tier.id;
    if (busy) {
      return { label: "One moment…", disabled: true, quiet: true, onClick: () => {} };
    }
    if (activePlanId === tier.id) {
      return { label: "Your current plan", disabled: true, quiet: true, onClick: () => {} };
    }
    if (availability?.open) {
      return {
        label: activePlanId ? `Switch to ${tier.name}` : `Select ${tier.name}`,
        disabled: false,
        quiet: false,
        onClick: () => void startCheckout(tier),
      };
    }

    // Closed. An approved invite for this tier is a live checkout link.
    if (
      interest?.status === "approved" &&
      interest.plan === tier.id &&
      interest.checkoutUrl
    ) {
      const url = interest.checkoutUrl;
      return {
        label: "Complete checkout",
        disabled: false,
        quiet: false,
        onClick: () => {
          captureCheckoutStarted(tier.id, "stripe");
          window.location.assign(url);
        },
      };
    }
    if (interest?.status === "pending") {
      return interest.plan === tier.id
        ? { label: "Request received", disabled: true, quiet: true, onClick: () => {} }
        : {
            label: "Request this tier instead",
            disabled: false,
            quiet: true,
            onClick: () => void requestInvitation(tier),
          };
    }
    return {
      label: "Request an invitation",
      disabled: false,
      quiet: false,
      onClick: () => void requestInvitation(tier),
    };
  };

  const noteFor = (tier: PlatinumTier): string | null => {
    if (!settled || availability?.open) return null;
    if (interest?.status === "pending" && interest.plan === tier.id) {
      return "We'll send a checkout link when a place opens.";
    }
    if (
      interest?.status === "approved" &&
      interest.plan === tier.id &&
      interest.checkoutUrl
    ) {
      return "A copy of this link is in your inbox.";
    }
    return null;
  };

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {PLATINUM_TIERS.map((tier) => (
          <PlatinumTierCard
            key={tier.id}
            tier={tier}
            action={actionFor(tier)}
            note={noteFor(tier)}
          />
        ))}
      </div>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </>
  );
}
