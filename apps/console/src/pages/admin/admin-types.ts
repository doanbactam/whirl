export type ListedUser = {
  id: string;
  email: string | null;
  name: string | null;
  plan: string;
  usageBalance: number | null;
  usageIncluded: number | null;
  messagesBalance: number | null;
  messagesIncluded: number | null;
};

export type ResetTarget =
  | { kind: "users"; ids: string[] }
  | { kind: "plan"; plan: string }
  | { kind: "all" };

export type MultiplierConfig = {
  multiplier?: number;
  headline?: string;
  subtext?: string;
  applyToFreeMessages?: boolean;
  startsAt?: number;
  expiresAt?: number;
  enabled?: boolean;
} | null;

export const PAGE_SIZE = 50;

export const PLAN_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "mini", label: "Mini" },
  { value: "turbo", label: "Turbo" },
  { value: "mega", label: "Mega" },
] as const;

export function formatAmount(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function multiplierLabel(multiplier: number): string {
  if (multiplier <= 0) return "1×";
  const rounded = Math.round((1 / multiplier) * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}×`;
}

export function toLocalInput(milliseconds?: number): string {
  if (milliseconds === undefined) return "";
  const date = new Date(milliseconds);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string): number | undefined {
  if (!value) return undefined;
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}
