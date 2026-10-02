"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { IconGiftFilled } from "@tabler/icons-react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useCustomer } from "autumn-js/react";
import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";
import {
  currentSlotPlan,
  eligible,
  PERKS,
} from "@whirl/backend/convex/slots/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsCard, SettingsRow } from "./settings-rows";
import { useRewardRefresh } from "@/components/slots/use-reward-refresh";

export function RedeemPerkCard() {
  const { isAuthenticated } = useConvexAuth();
  const redeem = useAction(api.slotCodes.redeem);
  const activate = useAction(api.slotActions.activate);
  const account = useQuery(api.slots.account, isAuthenticated ? {} : "skip");
  const { customer, refetch } = useCustomer();
  const plan = customer ? currentSlotPlan(customer) : null;
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  useRewardRefresh(isAuthenticated ? account?.prizes : undefined, refetch);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (operation: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFeedback(null);
    try {
      await operation();
    } catch (error) {
      if (mounted.current)
        setFeedback({
          text:
            error instanceof ConvexError && typeof error.data === "string"
              ? error.data
              : "We couldn’t confirm this request. Your prizes are saved; please try again.",
          error: true,
        });
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await redeem({ code });
      if (!mounted.current) return;
      setFeedback({
        text: result.ok ? `${result.name} claimed.` : result.message,
        error: !result.ok,
      });
      if (result.ok) setCode("");
    });
  };
  const activatePrize = (prizeId: Id<"slotPrizes">) =>
    void run(async () => {
      await activate({ prizeId });
    });
  return (
    <SettingsCard>
      <SettingsRow icon={IconGiftFilled} title="Redeem a perk">
        <form onSubmit={submit} className="flex flex-wrap gap-2">
          <Input
            aria-label="Arcade prize code"
            placeholder="WHIRL-…"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={60}
            className="min-w-40 flex-1 font-mono text-xs"
            disabled={pending}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={pending || !isAuthenticated || !code.trim()}
          >
            {pending ? "One moment…" : "Claim perk"}
          </Button>
        </form>
        {feedback && (
          <p
            role={feedback.error ? "alert" : "status"}
            className={`mt-2 text-xs leading-relaxed ${feedback.error ? "text-destructive" : "text-muted-foreground"}`}
          >
            {feedback.text}
          </p>
        )}
        <Link
          href="/about/slots"
          className="mt-3 inline-block text-xs text-muted-foreground underline underline-offset-4"
        >
          Visit the Token Arcade
        </Link>
      </SettingsRow>
      {account?.prizes
        .filter((prize) => {
          const perk = PERKS.find((perk) => perk.id === prize.sku);
          return (
            prize.status !== "active" &&
            perk &&
            plan !== null &&
            eligible(perk, plan)
          );
        })
        .map((prize) => (
          <SettingsRow
            key={prize._id}
            title={
              PERKS.find((perk) => perk.id === prize.sku)?.name ?? "Arcade perk"
            }
            description={prize.error}
            control={
              <Button
                variant="secondary"
                disabled={pending || prize.status !== "ready"}
                onClick={() => activatePrize(prize._id)}
              >
                {prize.status === "activating"
                  ? "Activating…"
                  : prize.status === "review"
                    ? "Needs a check"
                    : "Activate"}
              </Button>
            }
          >
            {prize.status === "review" && (
              <p className="break-all font-mono text-[10px] text-muted-foreground">
                Prize ID: {prize._id}
              </p>
            )}
          </SettingsRow>
        ))}
    </SettingsCard>
  );
}
