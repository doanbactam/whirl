export const STARTING_TOKENS = 100;
export const SPIN_COST = 10;
export const SPIN_COOLDOWN_MS = 3_000;
export const DAY_MS = 86_400_000;

export type Perk = {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  audience: "all" | "free" | "paid";
  kind: "messages" | "image" | "plan" | "credits";
  amount?: number;
  plan?: "mini" | "turbo" | "mega" | "platinum";
  days?: number;
  months?: number;
  dropWeight: number;
};

export const PERKS: readonly Perk[] = [
  {
    id: "messages",
    name: "25 extra messages",
    description:
      "Added to your current free allowance. Use before its next reset.",
    price: 60,
    stock: 1_000,
    audience: "free",
    kind: "messages",
    amount: 25,
    dropWeight: 45,
  },
  {
    id: "image",
    name: "Image day pass",
    description:
      "24 hours with the Image model. Your normal message limits apply.",
    price: 120,
    stock: 250,
    audience: "free",
    kind: "image",
    days: 1,
    dropWeight: 25,
  },
  {
    id: "mini-week",
    name: "7 days of Mini",
    description: "Every model and Mini’s regular usage allowance for a week.",
    price: 150,
    stock: 100,
    audience: "all",
    kind: "plan",
    plan: "mini",
    days: 7,
    dropWeight: 12,
  },
  {
    id: "turbo-week",
    name: "7 days of Turbo",
    description: "Every model, with Turbo’s extra headroom for a week.",
    price: 300,
    stock: 60,
    audience: "all",
    kind: "plan",
    plan: "turbo",
    days: 7,
    dropWeight: 6,
  },
  {
    id: "mega-week",
    name: "7 days of Mega",
    description: "A week with Mega’s full toolbox and usage allowance.",
    price: 600,
    stock: 30,
    audience: "all",
    kind: "plan",
    plan: "mega",
    days: 7,
    dropWeight: 3,
  },
  {
    id: "mini-month",
    name: "1 month of Mini",
    description: "A full month of Mini. No card, no automatic renewal.",
    price: 500,
    stock: 40,
    audience: "all",
    kind: "plan",
    plan: "mini",
    months: 1,
    dropWeight: 4,
  },
  {
    id: "turbo-month",
    name: "1 month of Turbo",
    description: "A full month of Turbo. No card, no automatic renewal.",
    price: 1_000,
    stock: 20,
    audience: "all",
    kind: "plan",
    plan: "turbo",
    months: 1,
    dropWeight: 2,
  },
  {
    id: "mega-month",
    name: "1 month of Mega",
    description: "A full month of Mega. No card, no automatic renewal.",
    price: 2_000,
    stock: 10,
    audience: "all",
    kind: "plan",
    plan: "mega",
    months: 1,
    dropWeight: 1,
  },
  {
    id: "credits",
    name: "$2 extra usage",
    description: "An extra $2 in your paid plan’s usage credit balance.",
    price: 250,
    stock: 200,
    audience: "paid",
    kind: "credits",
    amount: 2,
    dropWeight: 70,
  },
  {
    id: "platinum-month",
    name: "1 month of Platinum",
    description:
      "The rarest prize. Just two passes, shared by the shop and spins.",
    price: 5_000,
    stock: 2,
    audience: "all",
    kind: "plan",
    plan: "platinum",
    months: 1,
    dropWeight: 0.1,
  },
];

export const PLAN_RANK = {
  free: 0,
  mini: 1,
  turbo: 2,
  mega: 3,
  platinum: 4,
  platinum_max: 5,
} as const;
export type SlotPlan = keyof typeof PLAN_RANK;

/** Use the highest in-force plan, including trials and past-due subscriptions. */
export function currentSlotPlan(customer: {
  products?: readonly {
    id: string;
    status?: string | null;
    is_add_on?: boolean;
  }[];
}): SlotPlan {
  let current: SlotPlan = "free";
  for (const product of customer.products ?? []) {
    if (
      product.is_add_on ||
      !["active", "trialing", "past_due"].includes(
        product.status ?? "active",
      ) ||
      !Object.hasOwn(PLAN_RANK, product.id)
    )
      continue;
    const plan = product.id as SlotPlan;
    if (PLAN_RANK[plan] > PLAN_RANK[current]) current = plan;
  }
  return current;
}

export function eligible(perk: Perk, plan: SlotPlan) {
  if (perk.plan && PLAN_RANK[perk.plan] < PLAN_RANK[plan]) return false;
  return (
    perk.audience === "all" || (perk.audience === "paid") === (plan !== "free")
  );
}

/** Upgrades credit the current tier's pass value for the same duration. */
export function perkPrice(perk: Perk, plan: SlotPlan) {
  if (!perk.plan || PLAN_RANK[perk.plan] <= PLAN_RANK[plan]) return perk.price;
  const currentPass = PERKS.find(
    (item) =>
      item.plan === plan &&
      item.days === perk.days &&
      item.months === perk.months,
  );
  return Math.max(1, perk.price - (currentPass?.price ?? 0));
}

export function perkExpiry(perk: Perk, startsAt: number) {
  if (perk.days) return startsAt + perk.days * DAY_MS;
  if (!perk.months) return undefined;
  const end = new Date(startsAt);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + perk.months);
  const lastDay = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
  ).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end.getTime();
}

export const SYMBOLS = [
  "cherry",
  "bell",
  "gem",
  "seven",
  "clover",
  "gift",
] as const;
export type SlotSymbol = (typeof SYMBOLS)[number];
export type SpinOutcome = {
  reels: SlotSymbol[];
  payout: number;
  drop: boolean;
  label: string;
};

/** One integer draw, with exact, published odds; never driven by the browser. */
export function resolveSpin(ticket: number, variant: number): SpinOutcome {
  if (!Number.isInteger(ticket) || ticket < 0 || ticket >= 10_000)
    throw new Error("Invalid spin ticket");
  const symbol = SYMBOLS[variant % 5];
  if (ticket < 6_200)
    return {
      reels: [symbol, SYMBOLS[(variant + 1) % 5], SYMBOLS[(variant + 3) % 5]],
      payout: 0,
      drop: false,
      label: "No match this time",
    };
  if (ticket < 8_400)
    return {
      reels: [symbol, symbol, SYMBOLS[(variant + 1) % 5]],
      payout: 10,
      drop: false,
      label: "A pair! Spin returned",
    };
  if (ticket < 9_400)
    return {
      reels: ["cherry", "cherry", "cherry"],
      payout: 25,
      drop: false,
      label: "Cherry sweet",
    };
  if (ticket < 9_700)
    return {
      reels: ["bell", "bell", "bell"],
      payout: 50,
      drop: false,
      label: "Ring-a-ding!",
    };
  if (ticket < 9_790)
    return {
      reels: ["gem", "gem", "gem"],
      payout: 150,
      drop: false,
      label: "A gem of a spin",
    };
  if (ticket < 9_800)
    return {
      reels: ["seven", "seven", "seven"],
      payout: 1_000,
      drop: false,
      label: "Jackpot!",
    };
  return {
    reels: ["gift", "gift", "gift"],
    payout: 0,
    drop: true,
    label: "A little something extra",
  };
}

export function choosePerk(
  perks: readonly Perk[],
  random: number,
): Perk | undefined {
  let target = random * perks.reduce((sum, perk) => sum + perk.dropWeight, 0);
  return perks.find((perk) => (target -= perk.dropWeight) < 0);
}
