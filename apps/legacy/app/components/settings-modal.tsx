import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { useNavigate } from "@tanstack/react-router";
import { useCustomer } from "autumn-js/react";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import type { TablerIcon } from "@tabler/icons-react";
import {
  IconBarbell,
  IconBolt,
  IconBrain,
  IconChartBar,
  IconChevronDown,
  IconCheck,
  IconCreditCard,
  IconFeather,
  IconLogout,
  IconRocket,
  IconSearch,
  IconServer2,
  IconSettings,
  IconSparkles,
  IconUserCircle,
  IconWallet,
  IconWand,
  IconX,
} from "@tabler/icons-react";

import {
  DropdownShell,
  dropdownItemCompactClass,
} from "~/components/dropdown-menu";
import { ExtraUsagePane } from "~/components/extra-usage-pane";
import { McpServersPane } from "~/components/mcp/mcp-servers-pane";
import { SupermemoryControl, Switch } from "~/components/memory-settings";
import { PreferencesField } from "~/components/preferences-field";
import { Skeleton } from "~/components/skeleton";
import { Squircle } from "~/components/squircle";
import {
  AccountPaneSkeleton,
  BillingPaneSkeleton,
  UsagePaneSkeleton,
} from "~/components/settings-skeletons";
import { UsageMultiplierBadge } from "~/components/usage-multiplier-badge";
import { Spinner } from "~/components/spinner";
import { useActiveMultiplier } from "~/lib/admin";
import { showToast } from "~/data/toasts";
import { modelLabel } from "~/data/models";
import { readThemePref, setThemePref, type ThemePref } from "~/lib/theme";
import {
  readUnitsPref,
  setUnitsPref,
  type UnitsPref,
} from "~/lib/units";
import {
  readAutoScrollPref,
  setAutoScrollPref,
} from "~/lib/auto-scroll";
import { readShowStatsPref, setShowStatsPref } from "~/lib/stats";
import {
  readAskBeforeBigPastePref,
  setAskBeforeBigPastePref,
  subscribeAskBeforeBigPastePref,
} from "~/lib/paste-prompt";
import { findActivePlanProduct, readFreeMessages } from "~/lib/messages";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

export type SettingsSection =
  | "general"
  | "mcp-servers"
  | "account"
  | "usage"
  | "extra-usage"
  | "billing";

export const SETTINGS_SECTIONS: {
  id: SettingsSection;
  label: string;
  icon: TablerIcon;
}[] = [
  { id: "general", label: "General", icon: IconSettings },
  { id: "mcp-servers", label: "MCP Servers", icon: IconServer2 },
  { id: "account", label: "Account", icon: IconUserCircle },
  { id: "usage", label: "Usage", icon: IconChartBar },
  { id: "extra-usage", label: "Extra Usage", icon: IconWallet },
  { id: "billing", label: "Billing", icon: IconCreditCard },
];

const recentUsageRef = makeFunctionReference<"query">("messages:recentUsage");
const setUnitsSystemRef = makeFunctionReference<"mutation">(
  "userContext:setUnitsSystem",
);

type UsageActivityRow = {
  id: string;
  threadId: string;
  createdAt: number;
  model: string;
  thinking: boolean;
  search: boolean;
  usageCost: number;
  searchSources: number;
  thoughtMs: number;
};

// Keyed by raw model key — retired tiers ("Pro") stay so old activity rows
// keep their glyph.
const MODEL_ICONS: Record<string, TablerIcon> = {
  Auto: IconWand,
  Fast: IconFeather,
  Basic: IconBolt,
  Pro: IconRocket,
  Max: IconBarbell,
  Index: IconBrain,
};

const PLAN_BADGE_BY_PRODUCT: Record<string, "mini" | "turbo" | "mega"> = {
  mini: "mini",
  turbo: "turbo",
  mega: "mega",
};

const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

type ClerkErr = { errors?: Array<{ longMessage?: string; message?: string }> };

function describeError(err: unknown): string {
  const e = err as ClerkErr;
  const first = e?.errors?.[0];
  return (
    first?.longMessage ||
    first?.message ||
    (err instanceof Error ? err.message : "Something went wrong. Try again.")
  );
}

export function SettingsModal({
  open,
  onClose,
  initialSection,
}: {
  open: boolean;
  onClose: () => void;
  initialSection?: SettingsSection;
}) {
  const [section, setSection] = useState<SettingsSection>(
    initialSection ?? "general",
  );
  const [mounted, setMounted] = useState(false);
  const capture = useCapture();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) capture(ANALYTICS_EVENTS.settingsOpened);
  }, [open, capture]);

  // Jump to the requested tab whenever the modal is opened with a target.
  useEffect(() => {
    if (open && initialSection) setSection(initialSection);
  }, [open, initialSection]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const switchSection = (next: SettingsSection) => {
    capture(ANALYTICS_EVENTS.settingsTabSwitched, { section: next });
    setSection(next);
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="settings-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <motion.div
            key="settings-card"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", stiffness: 360, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl"
          >
            <Squircle
              radius={24}
              className="flex h-[640px] max-h-[88vh] overflow-hidden rounded-[24px] bg-white shadow-[0_20px_50px_rgba(0,0,0,0.18),_0_0_0_1px_rgba(0,0,0,0.06)] dark:bg-[#1a1a1a] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5),_0_0_0_1px_rgba(255,255,255,0.06)]"
            >
            <aside className="flex w-56 shrink-0 flex-col gap-1 bg-black/[0.02] p-3 dark:bg-white/[0.02]">
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg text-neutral-600 transition hover:bg-black/[0.06] dark:text-neutral-300 dark:hover:bg-white/[0.06]"
              >
                <IconX size={16} stroke={2} />
              </button>
              {SETTINGS_SECTIONS.map((s) => {
                const active = s.id === section;
                const Glyph = s.icon;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => switchSection(s.id)}
                    className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition ${
                      active
                        ? "bg-black/[0.06] font-medium text-neutral-900 dark:bg-white/[0.08] dark:text-neutral-100"
                        : "text-neutral-600 hover:bg-black/[0.04] dark:text-neutral-300 dark:hover:bg-white/[0.05]"
                    }`}
                  >
                    <Glyph size={15} stroke={active ? 2.25 : 2} />
                    {s.label}
                  </button>
                );
              })}
            </aside>

            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex h-14 shrink-0 items-center border-b border-black/[0.06] px-6 dark:border-white/[0.06]">
                <h2 className="mx-auto w-full max-w-[34rem] text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                  {SETTINGS_SECTIONS.find((s) => s.id === section)?.label}
                </h2>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="mx-auto w-full max-w-[34rem]">
                  {section === "general" ? (
                    <GeneralPane />
                  ) : section === "mcp-servers" ? (
                    <McpServersPane />
                  ) : section === "account" ? (
                    <AccountPane onClose={onClose} />
                  ) : section === "usage" ? (
                    <UsagePane onClose={onClose} />
                  ) : section === "extra-usage" ? (
                    <ExtraUsagePane onClose={onClose} />
                  ) : (
                    <BillingPane onClose={onClose} />
                  )}
                </div>
              </div>
            </div>
            </Squircle>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const UNITS_OPTIONS: { value: UnitsPref; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "metric", label: "Metric" },
  { value: "imperial", label: "Imperial" },
];

export function GeneralPane() {
  const { isSignedIn } = useUser();
  const syncUnits = useMutation(setUnitsSystemRef);
  const [pref, setPref] = useState<ThemePref>("system");
  const [unitsPref, setUnitsPrefState] = useState<UnitsPref>("auto");
  const [showStats, setShowStats] = useState(false);
  const [askBigPaste, setAskBigPaste] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    setPref(readThemePref());
    setUnitsPrefState(readUnitsPref());
    setShowStats(readShowStatsPref());
    setAskBigPaste(readAskBeforeBigPastePref());
    setAutoScroll(readAutoScrollPref());
  }, []);

  useEffect(() => {
    const onUnits = (event: Event) => {
      setUnitsPrefState((event as CustomEvent<UnitsPref>).detail);
    };
    window.addEventListener("units-change", onUnits);
    return () => window.removeEventListener("units-change", onUnits);
  }, []);

  // The paste modal's "don't ask again" tickbox flips this pref too — keep
  // the toggle honest if both surfaces get touched in one session.
  useEffect(() => subscribeAskBeforeBigPastePref(setAskBigPaste), []);

  const change = (v: ThemePref) => {
    setPref(v);
    setThemePref(v);
  };

  const changeUnits = (v: UnitsPref) => {
    setUnitsPrefState(v);
    setUnitsPref(v);
    if (isSignedIn) {
      void syncUnits({ unitsSystem: v }).catch(() => {});
    }
  };

  const changeShowStats = (next: boolean) => {
    setShowStats(next);
    setShowStatsPref(next);
  };

  const changeAskBigPaste = (next: boolean) => {
    setAskBigPaste(next);
    setAskBeforeBigPastePref(next);
  };

  const changeAutoScroll = (next: boolean) => {
    setAutoScroll(next);
    setAutoScrollPref(next);
  };

  return (
    <div className="flex flex-col">
      <Row label="Appearance">
        <Select<ThemePref>
          value={pref}
          onChange={change}
          options={THEME_OPTIONS}
        />
      </Row>
      <Row
        label="Units"
        description="Temperature and wind in weather widgets"
      >
        <Select<UnitsPref>
          value={unitsPref}
          onChange={changeUnits}
          options={UNITS_OPTIONS}
        />
      </Row>
      <Row
        label="Auto-scroll"
        description="Follow new messages as they stream in. When off, the chat stays put and you scroll on your own terms."
      >
        <Switch checked={autoScroll} onChange={changeAutoScroll} />
      </Row>
      <Row
        label="Show stats"
        description="Show output tokens and response time under each reply"
      >
        <Switch checked={showStats} onChange={changeShowStats} />
      </Row>
      <Row
        label="Ask about big pastes"
        description="Offer to turn long pastes into a .md attachment. When off, they land in the composer as plain text."
      >
        <Switch checked={askBigPaste} onChange={changeAskBigPaste} />
      </Row>
      <Row
        label="Supermemory"
        description="Let Whirl use profile facts and semantic memory across every chat. Turn it off to pause saving and stop using saved context."
      >
        <SupermemoryControl />
      </Row>
      <PreferencesField />
    </div>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 min-w-[140px] items-center justify-between gap-2 rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] font-medium text-neutral-900 outline-none transition hover:bg-black/[0.03] focus-visible:border-black/20 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:bg-white/[0.04] dark:focus-visible:border-white/30"
      >
        <span>{current?.label}</span>
        <IconChevronDown
          size={14}
          stroke={2}
          className={`text-neutral-500 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            role="listbox"
            className="absolute right-0 top-[calc(100%+6px)] z-10 min-w-[160px]"
          >
            <DropdownShell subtle>
              {options.map((opt) => {
                const selected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={`${dropdownItemCompactClass} text-neutral-800 dark:text-neutral-100`}
                  >
                    <span>{opt.label}</span>
                    {selected && (
                      <IconCheck
                        size={14}
                        stroke={2.25}
                        className="text-neutral-500 dark:text-neutral-300"
                      />
                    )}
                  </button>
                );
              })}
            </DropdownShell>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AccountPane({ onClose }: { onClose: () => void }) {
  const clerk = useClerk();
  const { user, isLoaded } = useUser();
  const capture = useCapture();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const savingNamesRef = useRef(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? "");
    setLastName(user.lastName ?? "");
  }, [user?.id]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  const email = user?.primaryEmailAddress?.emailAddress;
  const avatarSrc = photoPreview ?? user?.imageUrl ?? null;

  const saveNames = useCallback(async () => {
    if (!user || savingNamesRef.current) return;

    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    if (
      trimmedFirst === (user.firstName ?? "") &&
      trimmedLast === (user.lastName ?? "")
    ) {
      return;
    }

    savingNamesRef.current = true;
    try {
      await user.update({
        firstName: trimmedFirst,
        lastName: trimmedLast,
      });
      setFirstName(trimmedFirst);
      setLastName(trimmedLast);
      capture(ANALYTICS_EVENTS.profileUpdated, { field: "name" });
    } catch (err) {
      showToast({ message: describeError(err), tone: "danger" });
    } finally {
      savingNamesRef.current = false;
    }
  }, [user, firstName, lastName]);

  const handlePhotoChange = async (file: File) => {
    if (!user) return;

    if (!file.type.startsWith("image/")) {
      showToast({ message: "Please choose an image file.", tone: "danger" });
      return;
    }
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      showToast({ message: "Image must be 5 MB or smaller.", tone: "danger" });
      return;
    }

    const preview = URL.createObjectURL(file);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return preview;
    });
    setUploadingPhoto(true);

    try {
      await user.setProfileImage({ file });
      capture(ANALYTICS_EVENTS.profilePhotoChanged);
    } catch (err) {
      setPhotoPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      showToast({ message: describeError(err), tone: "danger" });
    } finally {
      setUploadingPhoto(false);
    }
  };

  if (!isLoaded) {
    return <AccountPaneSkeleton />;
  }

  if (!user) {
    return (
      <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
        Sign in to manage your account.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      <Row label="Profile photo" description="JPG, PNG, or WebP. Up to 5 MB.">
        <div className="flex items-center gap-2.5">
          <div className="relative h-9 w-9 shrink-0">
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt=""
                className={`h-9 w-9 rounded-full object-cover outline outline-1 outline-black/[0.06] transition-opacity duration-200 dark:outline-white/[0.08] ${
                  uploadingPhoto ? "opacity-50" : "opacity-100"
                }`}
              />
            ) : (
              <div className="h-9 w-9 rounded-full border border-black/[0.08] dark:border-white/[0.1]" />
            )}
            {uploadingPhoto && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <Spinner size={14} className="text-blue-500" />
              </div>
            )}
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handlePhotoChange(file);
            }}
          />
          <button
            type="button"
            disabled={uploadingPhoto}
            onClick={() => photoInputRef.current?.click()}
            className="inline-flex h-9 items-center rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 disabled:opacity-60 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
          >
            Change
          </button>
        </div>
      </Row>

      <Row label="First name">
        <AccountInlineInput
          value={firstName}
          onChange={setFirstName}
          onCommit={() => void saveNames()}
          autoComplete="given-name"
        />
      </Row>

      <Row label="Last name">
        <AccountInlineInput
          value={lastName}
          onChange={setLastName}
          onCommit={() => void saveNames()}
          autoComplete="family-name"
        />
      </Row>

      {email ? (
        <Row label="Email">
          <span className="max-w-[200px] truncate text-[13px] text-neutral-600 dark:text-neutral-300">
            {email}
          </span>
        </Row>
      ) : null}

      <Row
        label="Email & password"
        description="Update your sign-in email or password."
      >
        <button
          type="button"
          onClick={() => {
            onClose();
            clerk.openUserProfile();
          }}
          className="inline-flex h-9 items-center rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
        >
          Manage
        </button>
      </Row>

      <Row label="Session" description="Sign out of Whirl on this device.">
        <button
          type="button"
          onClick={() => {
            onClose();
            void clerk.signOut({ redirectUrl: "/" });
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-500/30 px-3 text-[13px] font-medium text-red-600 transition hover:bg-red-500/[0.06] dark:border-red-400/30 dark:text-red-300 dark:hover:bg-red-400/[0.08]"
        >
          <IconLogout size={14} stroke={2} />
          Log out
        </button>
      </Row>
    </div>
  );
}

function AccountInlineInput({
  value,
  onChange,
  onCommit,
  autoComplete,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  autoComplete?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      autoComplete={autoComplete}
      className="h-9 w-[min(100%,200px)] min-w-[140px] rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] font-medium text-neutral-900 outline-none transition hover:bg-black/[0.03] focus-visible:border-black/20 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:bg-white/[0.04] dark:focus-visible:border-white/30"
    />
  );
}

// How often an Autumn quota interval refreshes, in plain words. Defaults to
// "weekly" — the cadence every current plan is configured with.
const INTERVAL_CADENCE: Record<string, string> = {
  minute: "every minute",
  hour: "hourly",
  day: "daily",
  week: "weekly",
  month: "monthly",
  quarter: "quarterly",
  semi_annual: "every six months",
  year: "yearly",
};

function quotaCadence(interval?: string | null): string {
  return (interval && INTERVAL_CADENCE[interval]) || "weekly";
}

/** "in 3 days (Mon, Jul 14)" — when the quota next refills, human-first. */
function nextResetPhrase(nextResetAt: number): string {
  const diff = nextResetAt - Date.now();
  if (diff <= 0) return "any moment now";
  const hours = Math.round(diff / 3_600_000);
  if (hours < 1) return "in under an hour";
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(diff / 86_400_000);
  const date = new Date(nextResetAt).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return days === 1 ? `tomorrow (${date})` : `in ${days} days (${date})`;
}

/**
 * The quota card's footnote: the refill cadence plus when the next reset
 * lands, straight from the Autumn feature. Null (renders nothing) until
 * Autumn reports a reset timestamp.
 */
function quotaResetNote(
  label: string,
  feature?: { interval?: string | null; next_reset_at?: number | null },
): string | null {
  if (typeof feature?.next_reset_at !== "number") return null;
  return `${label} ${quotaCadence(feature.interval)} · next reset ${nextResetPhrase(
    feature.next_reset_at,
  )}`;
}

export function UsagePane({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { isSignedIn } = useUser();
  const { customer, isLoading } = useCustomer();

  const activity = useQuery(recentUsageRef, { limit: 50 }) as
    | UsageActivityRow[]
    | undefined;

  const activeProduct = findActivePlanProduct(customer?.products);
  const planName = activeProduct?.name ?? "Free";
  const planBadge = activeProduct
    ? PLAN_BADGE_BY_PRODUCT[activeProduct.id]
    : undefined;

  const features = (customer?.features ?? {}) as Record<
    string,
    | {
        unlimited?: boolean;
        balance?: number;
        included_usage?: number;
        usage?: number;
        interval?: string | null;
        next_reset_at?: number | null;
      }
    | undefined
  >;
  const usageFeature = features.usage;
  const unlimited = !!usageFeature?.unlimited;
  const included =
    typeof usageFeature?.included_usage === "number"
      ? usageFeature.included_usage
      : 0;
  const balance =
    typeof usageFeature?.balance === "number" ? usageFeature.balance : 0;
  // Mirror the usage-multiplier event: a 0.5 multiplier ("2× usage") makes each
  // prompt cost half, so the quota-used % shown shrinks to match.
  const multiplierEvent = useActiveMultiplier();
  const usedFactor =
    multiplierEvent && multiplierEvent.multiplier > 0
      ? multiplierEvent.multiplier
      : 1;
  const used = Math.max(0, included - balance);
  const usedPct =
    !unlimited && included > 0
      ? Math.min(100, Math.max(0, (used / included) * 100 * usedFactor))
      : 0;

  const free = readFreeMessages(customer);
  const msgUsedPct =
    free.included > 0
      ? Math.min(100, Math.max(0, (free.used / free.included) * 100))
      : 0;

  const totalCostThisPeriod = useMemo(() => {
    if (!activity) return 0;
    return activity.reduce((acc, row) => acc + row.usageCost, 0);
  }, [activity]);

  // Quotas refill on a schedule (weekly on current plans) — say so, and when.
  const quotaNote = quotaResetNote("Quota resets", usageFeature);
  const freeResetNote = quotaResetNote("Free messages reset", features.messages);

  // For a signed-in user a null customer only means "not loaded yet" (or a
  // failed fetch that SWR is retrying) — never render it as the free plan.
  if (!customer && (isLoading || isSignedIn)) {
    return <UsagePaneSkeleton />;
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-4 pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
            Current plan
          </span>
          <div className="flex items-center gap-2.5">
            {planBadge ? (
              <img
                src={`/plan-badges/${planBadge}.svg`}
                alt={planName}
                className="h-4 w-auto brightness-0 opacity-80 dark:opacity-90 dark:invert"
              />
            ) : (
              <span className="text-[18px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                {planName}
              </span>
            )}
          </div>
        </div>
        {!unlimited && (
          <button
            type="button"
            onClick={() => {
              onClose();
              void navigate({ to: "/pricing" });
            }}
            className="inline-flex h-9 items-center rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
          >
            Upgrade
          </button>
        )}
      </div>

      <div className="rounded-xl border border-black/[0.06] bg-black/[0.015] p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
        {free.isFree ? (
          <>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                Free messages
              </span>
              <span className="text-[15px] font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                {free.remaining} / {free.included} left
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.08]">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  free.remaining <= 0
                    ? "bg-orange-500"
                    : msgUsedPct >= 60
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
                style={{ width: `${Math.max(2, msgUsedPct)}%` }}
              />
            </div>
            <p className="mt-2 text-[12px] text-neutral-500 dark:text-neutral-400">
              {free.remaining <= 0
                ? "You've used all your free messages. Upgrade to keep going."
                : "Upgrade for a weekly usage budget and better models."}
            </p>
            {freeResetNote && (
              <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
                {freeResetNote}
              </p>
            )}
          </>
        ) : unlimited ? (
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
              Unlimited usage
            </span>
            <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
              No quota
            </span>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                Quota used
              </span>
              <span className="text-[15px] font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                {usedPct.toFixed(usedPct >= 10 ? 0 : 1)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.08]">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  usedPct >= 90
                    ? "bg-red-500"
                    : usedPct >= 70
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
                style={{ width: `${Math.max(2, usedPct)}%` }}
              />
            </div>
            {quotaNote && (
              <p className="mt-2 text-[12px] text-neutral-500 dark:text-neutral-400">
                {quotaNote}
              </p>
            )}
          </>
        )}
      </div>

      <UsageMultiplierBadge
        context={free.isFree ? "free" : "paid"}
        className="mt-3"
      />

      <div className="mt-5 mb-2 flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
          Recent activity
        </span>
        {activity && activity.length > 0 && (
          <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
            Last {activity.length} {activity.length === 1 ? "request" : "requests"}
          </span>
        )}
      </div>

      <UsageActivityTable
        rows={activity}
        included={included}
        unlimited={unlimited}
        totalCost={totalCostThisPeriod}
        onSelect={(threadId) => {
          onClose();
          void navigate({ to: `/thread/${threadId}` });
        }}
      />
    </div>
  );
}

function UsageActivityTable({
  rows,
  included,
  unlimited,
  totalCost,
  onSelect,
}: {
  rows: UsageActivityRow[] | undefined;
  included: number;
  unlimited: boolean;
  totalCost: number;
  onSelect: (threadId: string) => void;
}) {
  if (rows === undefined) {
    return (
      <div className="overflow-hidden rounded-xl border border-black/[0.06] dark:border-white/[0.06]">
        <div className="grid grid-cols-[1fr_auto] items-center gap-3 bg-black/[0.02] px-3 py-2 dark:bg-white/[0.03]">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
        <div className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 px-3 py-2">
              <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="ml-auto h-3 w-10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-black/[0.1] text-[12.5px] text-neutral-500 dark:border-white/[0.1] dark:text-neutral-400">
        No activity yet — start a conversation to see usage here.
      </div>
    );
  }

  // For free / no-quota plans, % of quota is meaningless. Fall back to a
  // share-of-recent-activity percentage so the column still tells a story.
  const denom = !unlimited && included > 0 ? included : totalCost;
  const denomLabel =
    !unlimited && included > 0 ? "% of quota" : "% of recent";

  return (
    <div className="overflow-hidden rounded-xl border border-black/[0.06] dark:border-white/[0.06]">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 bg-black/[0.02] px-3 py-2 text-[12px] font-medium text-neutral-500 dark:bg-white/[0.03] dark:text-neutral-400">
        <span>Request</span>
        <span>When</span>
        <span className="min-w-[72px] text-right">{denomLabel}</span>
      </div>
      <ul className="max-h-[320px] divide-y divide-black/[0.04] overflow-y-auto dark:divide-white/[0.05]">
        {rows.map((row) => {
          const pct = denom > 0 ? (row.usageCost / denom) * 100 : 0;
          const Icon = MODEL_ICONS[row.model] ?? IconSparkles;
          const Glyph = row.search ? IconSearch : Icon;
          const details: string[] = [];
          if (row.search && row.searchSources > 0) {
            details.push(
              `${row.searchSources} ${row.searchSources === 1 ? "source" : "sources"}`,
            );
          }
          if (row.thinking) details.push("thinking");
          const navigable = row.threadId !== "";
          return (
            <li key={row.id}>
              <button
                type="button"
                disabled={!navigable}
                onClick={() => navigable && onSelect(row.threadId)}
                className={`grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2 text-left transition ${
                  navigable
                    ? "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                    : "cursor-default"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black/[0.05] text-neutral-700 dark:bg-white/[0.06] dark:text-neutral-200">
                    <Glyph size={14} stroke={2} />
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                      {modelLabel(row.model)}
                      {details.length > 0 ? (
                        <span className="ml-1.5 text-[12px] font-normal text-neutral-500 dark:text-neutral-400">
                          · {details.join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 text-[12px] text-neutral-500 dark:text-neutral-400">
                  {formatRelative(row.createdAt)}
                </span>
                <span className="min-w-[72px] shrink-0 text-right text-[12.5px] font-medium tabular-nums text-neutral-700 dark:text-neutral-200">
                  {formatPercent(pct)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatPercent(pct: number) {
  if (!Number.isFinite(pct) || pct <= 0) return "<0.01%";
  if (pct < 0.01) return "<0.01%";
  if (pct < 1) return `${pct.toFixed(2)}%`;
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

function formatRelative(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "Just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function BillingPane({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const capture = useCapture();
  const { isSignedIn } = useUser();
  const { customer, openBillingPortal, cancel, refetch, isLoading } =
    useCustomer();
  const [busy, setBusy] = useState<"portal" | "cancel" | null>(null);
  const [confirming, setConfirming] = useState(false);

  const activeProduct = findActivePlanProduct(customer?.products);
  const isPaid = !!activeProduct && activeProduct.id !== "free";
  const free = readFreeMessages(customer);
  const planName = activeProduct?.name ?? "Free";
  const planBadge = activeProduct
    ? PLAN_BADGE_BY_PRODUCT[activeProduct.id]
    : undefined;
  const scheduledCancel = !!activeProduct?.canceled_at;
  const periodEnd = activeProduct?.current_period_end;
  const trialEnd = activeProduct?.trial_ends_at;
  const status = activeProduct?.status;

  const statusLabel = scheduledCancel
    ? "Canceling"
    : status === "trialing"
      ? "Trial"
      : status === "active"
        ? "Active"
        : status === "past_due"
          ? "Past due"
          : "Free";

  const dateLabel = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const handlePortal = async () => {
    setBusy("portal");
    capture(ANALYTICS_EVENTS.billingPortalOpened);
    try {
      const res = await openBillingPortal({ returnUrl: window.location.href });
      const url = (res as { data?: { url?: string | null } })?.data?.url;
      if (url) window.location.href = url;
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async () => {
    if (!activeProduct) return;
    setBusy("cancel");
    try {
      await cancel({ productId: activeProduct.id });
      capture(ANALYTICS_EVENTS.subscriptionCancelled, {
        plan: activeProduct.id,
      });
      await refetch();
      setConfirming(false);
    } finally {
      setBusy(null);
    }
  };

  // Same rule as UsagePane: signed in + no customer = still loading, not free.
  if (!customer && (isLoading || isSignedIn)) {
    return <BillingPaneSkeleton />;
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-4 pb-5">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
            Current plan
          </span>
          <div className="flex items-center gap-2.5">
            {planBadge ? (
              <img
                src={`/plan-badges/${planBadge}.svg`}
                alt={planName}
                className="h-4 w-auto brightness-0 opacity-80 dark:opacity-90 dark:invert"
              />
            ) : (
              <span className="text-[18px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                {planName}
              </span>
            )}
            <span
              className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold ${
                scheduledCancel
                  ? "bg-amber-500/10 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300"
                  : isPaid
                    ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"
                    : "bg-black/[0.06] text-neutral-600 dark:bg-white/[0.08] dark:text-neutral-300"
              }`}
            >
              {statusLabel}
            </span>
          </div>
          {scheduledCancel && periodEnd ? (
            <span className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
              Ends {dateLabel(periodEnd)}
            </span>
          ) : trialEnd ? (
            <span className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
              Trial ends {dateLabel(trialEnd)}
            </span>
          ) : isPaid && periodEnd ? (
            <span className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
              Renews {dateLabel(periodEnd)}
            </span>
          ) : !isPaid ? (
            <span className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">
              {free.remaining <= 0
                ? "You're out of free messages."
                : `You're on the free plan — ${free.remaining} of ${free.included} messages left.`}
            </span>
          ) : null}
        </div>
      </div>

      <div className="border-t border-black/[0.06] dark:border-white/[0.06]">
        <Row
          label={isPaid ? "Change plan" : "Upgrade"}
          description="Browse plans and switch any time."
        >
          <button
            type="button"
            onClick={() => {
              onClose();
              void navigate({ to: "/pricing" });
            }}
            className="inline-flex h-9 items-center rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
          >
            See plans
          </button>
        </Row>

        <Row
          label="Manage billing"
          description="Open the Stripe portal to update payment methods, view invoices, and download receipts."
        >
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void handlePortal()}
            className="inline-flex h-9 min-w-[124px] items-center justify-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 disabled:opacity-60 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
          >
            {busy === "portal" ? (
              <Spinner size={14} className="text-blue-500" />
            ) : (
              "Manage billing"
            )}
          </button>
        </Row>

        {isPaid && !scheduledCancel && (
          <Row
            label="Cancel subscription"
            description={
              periodEnd
                ? `You'll keep access until ${dateLabel(periodEnd)}.`
                : "You'll keep access until the end of the current period."
            }
          >
            {confirming ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setConfirming(false)}
                  className="h-9 rounded-lg px-3 text-[13px] text-neutral-600 hover:bg-black/[0.04] disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-white/[0.06]"
                >
                  Keep
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void handleCancel()}
                  className="inline-flex h-9 min-w-[120px] items-center justify-center gap-2 rounded-lg bg-red-600 px-3 text-[13px] font-medium text-white transition hover:bg-red-500 disabled:opacity-60"
                >
                  {busy === "cancel" ? (
                    <Spinner size={14} className="text-white" />
                  ) : (
                    "Confirm cancel"
                  )}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="inline-flex h-9 items-center rounded-lg border border-red-500/30 px-3 text-[13px] font-medium text-red-600 transition hover:bg-red-500/[0.06] dark:border-red-400/30 dark:text-red-300 dark:hover:bg-red-400/[0.08]"
              >
                Cancel
              </button>
            )}
          </Row>
        )}
      </div>
    </div>
  );
}

export function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-black/[0.04] py-3.5 last:border-b-0 dark:border-white/[0.05]">
      <div className="flex min-w-0 flex-col">
        <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
          {label}
        </span>
        {description && (
          <span className="mt-0.5 text-[12px] text-neutral-500 dark:text-neutral-400">
            {description}
          </span>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
