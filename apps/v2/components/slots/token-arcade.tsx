"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCustomer } from "autumn-js/react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@whirl/backend/convex/_generated/api";
import type { Doc } from "@whirl/backend/convex/_generated/dataModel";
import {
  PERKS,
  currentSlotPlan,
  SPIN_COOLDOWN_MS,
  STARTING_TOKENS,
} from "@whirl/backend/convex/slots/catalog";
import { SlotMachine, type SlotSession } from "./slot-machine";
import { PerkShop, PrizeTray } from "./perk-shop";
import { ArcadeDetails } from "./arcade-details";
import { useGuestWallet } from "./use-guest-wallet";
import { GuestPrizeCodes } from "./guest-prize-codes";
import { useRewardRefresh } from "./use-reward-refresh";
import "./slot-machine.css";
import "./slots.css";

function displayError(error: unknown) {
  return error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : "The arcade couldn’t confirm that request. Check your balance and recent activity before trying again.";
}

export function TokenArcade() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const guest = useGuestWallet();
  const { customer, refetch } = useCustomer();
  const account = useQuery(
    api.slots.account,
    isLoading
      ? "skip"
      : isAuthenticated
        ? {}
        : guest.key
          ? { guestKey: guest.key }
          : "skip",
  );
  const savedGuestPrizes = useQuery(
    api.slotCodes.guestPrizes,
    isAuthenticated && guest.key ? { guestKey: guest.key } : "skip",
  );
  const shop = useQuery(api.slots.shop);
  const play = useAction(api.slotActions.play);
  const activate = useAction(api.slotActions.activate);
  const [session, setSession] = useState<SlotSession | null>(null);
  const [heldBalance, setHeldBalance] = useState(STARTING_TOKENS);
  const [heldHistory, setHeldHistory] = useState<Doc<"slotPlays">[]>([]);
  const [heldPrizes, setHeldPrizes] = useState<Doc<"slotPrizes">[]>([]);
  const [pending, setPending] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [cooldownId, setCooldownId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useRewardRefresh(isAuthenticated ? account?.prizes : undefined, refetch);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!cooldownId) return;
    const timer = setTimeout(() => setCooling(false), SPIN_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [cooldownId]);
  const balance = account?.tokens ?? STARTING_TOKENS;
  const plan = isLoading
    ? null
    : !isAuthenticated
      ? "free"
      : customer
        ? currentSlotPlan(customer)
        : null;
  const busy = pending || session !== null;

  const transact = useCallback(
    async (sku?: string, expectedPrice?: number) => {
      if (inFlight.current || !account) return;
      inFlight.current = true;
      setPending(true);
      setError(null);
      setNotice(null);
      const id = crypto.randomUUID();
      if (!sku) {
        setCooling(true);
        setCooldownId(id);
        setHeldBalance(account.tokens);
        setHeldHistory(account.history);
        setHeldPrizes(account.prizes);
        setSession({ id, result: null });
      }
      try {
        const result = await play({
          requestId: id,
          revision: account.revision,
          ...(sku ? { sku, expectedPrice } : {}),
          ...(!isAuthenticated && guest.key ? { guestKey: guest.key } : {}),
        });
        if (!mounted.current) return;
        if (sku) setNotice(`${result.label} claimed.`);
        else setSession({ id, result });
      } catch (failure) {
        if (!mounted.current) return;
        setError(displayError(failure));
        setSession(null);
        inFlight.current = false;
      } finally {
        if (mounted.current) setPending(false);
        if (sku) inFlight.current = false;
      }
    },
    [isAuthenticated, guest.key, account, play],
  );

  const settle = useCallback(() => {
    setSession(null);
    inFlight.current = false;
  }, []);
  const activatePrize = async (prizeId: Doc<"slotPrizes">["_id"]) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await activate({ prizeId });
    } catch (failure) {
      if (mounted.current) setError(displayError(failure));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };

  return (
    <article className="token-arcade">
      <header className="slot-page-heading">
        <h1>Token Arcade</h1>
      </header>
      <SlotMachine
        balance={session ? heldBalance : balance}
        session={session}
        disabled={isLoading || pending || cooling || !account || balance < 10}
        onSpin={() => void transact()}
        onSettled={settle}
      />
      <div className="slot-status-area">
        {error && (
          <p className="slot-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="slot-notice" role="status">
            {notice}
          </p>
        )}
        {balance < 10 && !session && (
          <p className="slot-notice">You need 10 tokens to spin.</p>
        )}
        {!isAuthenticated && !isLoading && !guest.persistent && (
          <p className="slot-sign-in">
            Browser storage is unavailable. Save your prize codes before
            leaving.
          </p>
        )}
      </div>
      <ArcadeDetails
        history={session ? heldHistory : (account?.history ?? [])}
      />
      <GuestPrizeCodes
        plan={plan}
        prizes={
          isAuthenticated
            ? (savedGuestPrizes ?? [])
            : session
              ? heldPrizes
              : (account?.prizes ?? [])
        }
      />
      {isAuthenticated && (
        <PrizeTray
          prizes={session ? heldPrizes : (account?.prizes ?? [])}
          items={PERKS}
          plan={plan}
          busy={busy}
          onActivate={(id) => void activatePrize(id)}
        />
      )}
      <div id="token-shop">
        <PerkShop
          items={shop}
          balance={balance}
          plan={plan}
          busy={busy || !account}
          onBuy={(sku, price) => void transact(sku, price)}
        />
      </div>
    </article>
  );
}
