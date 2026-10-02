import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { makeFunctionReference } from "convex/server";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconRefresh,
  IconSparkles,
  IconUsersGroup,
} from "@tabler/icons-react";

import { DepthButton } from "~/components/depth-button";
import { showToast } from "~/data/toasts";
import { multiplierLabel, useIsAdmin } from "~/lib/admin";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
  head: () => ({
    meta: [
      { title: "Admin · Whirl" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type ListedUser = {
  id: string;
  email: string | null;
  name: string | null;
  plan: string;
  usageBalance: number | null;
  usageIncluded: number | null;
  messagesBalance: number | null;
  messagesIncluded: number | null;
};

type ResetTarget =
  | { kind: "users"; ids: string[] }
  | { kind: "plan"; plan: string }
  | { kind: "all" };

type ResetResult = {
  total: number;
  succeeded: number;
  failed: { id: string; error?: string }[];
  truncated: boolean;
};

type MultiplierConfig = {
  multiplier?: number;
  headline?: string;
  subtext?: string;
  applyToFreeMessages?: boolean;
  startsAt?: number;
  expiresAt?: number;
  enabled?: boolean;
} | null;

const listUsersRef = makeFunctionReference<"action">("admin:listUsers");
const resetUsageRef = makeFunctionReference<"action">("admin:resetUsage");
const getMultiplierConfigRef = makeFunctionReference<"query">(
  "admin:getMultiplierConfig",
);
const setMultiplierConfigRef = makeFunctionReference<"mutation">(
  "admin:setMultiplierConfig",
);

const PAGE_SIZE = 50;
const PLAN_OPTIONS = ["free", "mini", "turbo", "mega"] as const;

function fmtAmount(value: number | null): string {
  if (value == null) return "—";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

function toLocalInput(ms?: number): string {
  if (ms == null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

function AdminPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();

  if (!isAdmin) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center px-6 text-center">
        <IconAlertTriangle
          size={28}
          stroke={2}
          className="text-neutral-400"
        />
        <h1 className="mt-3 text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
          Admins only
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
          You don't have access to this page.
        </p>
        <button
          type="button"
          onClick={() => void navigate({ to: "/" })}
          className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] text-neutral-600 hover:bg-black/[0.04] dark:text-neutral-300 dark:hover:bg-white/[0.06]"
        >
          <IconChevronLeft size={14} stroke={2} />
          Back to Whirl
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10 text-neutral-900 dark:text-neutral-100 sm:px-10 sm:py-14">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Admin
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
            Reset usage quotas and run usage-multiplier events.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void navigate({ to: "/" })}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] text-neutral-600 hover:bg-black/[0.04] dark:text-neutral-300 dark:hover:bg-white/[0.06]"
        >
          <IconChevronLeft size={14} stroke={2} />
          Back
        </button>
      </header>

      <MultiplierSection />
      <div className="my-10 h-px bg-black/[0.06] dark:bg-white/[0.08]" />
      <ResetSection />
    </div>
  );
}

// --- Rate-limit reset section ----------------------------------------------

function ResetSection() {
  const listUsers = useAction(listUsersRef);
  const resetUsage = useAction(resetUsageRef);

  const [users, setUsers] = useState<ListedUser[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [planFilter, setPlanFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [resetMessage, setResetMessage] = useState("");

  // Searching scans every Autumn page server-side (it can't be filtered at
  // the source), so wait for a typing pause instead of scanning per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0);
      setDebouncedSearch(search.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await listUsers({
        limit: PAGE_SIZE,
        offset,
        plan: planFilter || undefined,
        search: debouncedSearch || undefined,
      })) as {
        users: ListedUser[];
        total: number | null;
        truncated: boolean;
      };
      setUsers(res.users);
      setTotal(res.total);
      setTruncated(res.truncated);
      setSelected(new Set());
    } catch (e) {
      showToast({
        tone: "danger",
        message: e instanceof Error ? e.message : "Failed to load users",
      });
    } finally {
      setLoading(false);
    }
  }, [listUsers, offset, planFilter, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  // The server result is authoritative (it scanned all pages); this only
  // narrows the visible page instantly while the debounce is still counting.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.name ?? "").toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q),
    );
  }, [users, search]);

  const allSelected =
    filtered.length > 0 && filtered.every((u) => selected.has(u.id));

  const toggleAll = () => {
    setSelected((prev) => {
      if (filtered.every((u) => prev.has(u.id))) {
        const next = new Set(prev);
        for (const u of filtered) next.delete(u.id);
        return next;
      }
      const next = new Set(prev);
      for (const u of filtered) next.add(u.id);
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runReset = async (target: ResetTarget, label: string) => {
    setBusy(true);
    try {
      const res = (await resetUsage({
        target,
        message: resetMessage.trim() || undefined,
      })) as ResetResult;
      const failedNote = res.failed.length
        ? `, ${res.failed.length} failed`
        : "";
      const truncNote = res.truncated ? " (list truncated)" : "";
      showToast({
        message: `${label}: reset ${res.succeeded}/${res.total}${failedNote}${truncNote}`,
      });
      await load();
    } catch (e) {
      showToast({
        tone: "danger",
        message: e instanceof Error ? e.message : "Reset failed",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <IconUsersGroup
          size={18}
          stroke={2}
          className="text-neutral-500"
        />
        <h2 className="text-[15px] font-semibold">Reset usage quotas</h2>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-[12px] font-medium text-neutral-500">
          Message shown to reset users (optional)
        </label>
        <input
          type="text"
          value={resetMessage}
          onChange={(e) => setResetMessage(e.target.value)}
          placeholder="Lucky you — your usage quota just got a fresh reset. 🎉"
          className="h-9 w-full rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] outline-none focus:ring-2 focus:ring-[#178dfb]/30 dark:border-white/[0.08] dark:bg-[#1a1a1a]"
        />
        <p className="mt-1 text-[11px] text-neutral-400">
          Each affected user sees this as a one-time modal on their next visit.
          Leave blank to send a random playful message.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search email, name, or id…"
          className="h-9 w-56 rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] outline-none focus:ring-2 focus:ring-[#178dfb]/30 dark:border-white/[0.08] dark:bg-[#1a1a1a]"
        />
        <select
          value={planFilter}
          onChange={(e) => {
            setOffset(0);
            setPlanFilter(e.target.value);
          }}
          className="h-9 rounded-lg border border-black/[0.08] bg-white px-2 text-[13px] outline-none dark:border-white/[0.08] dark:bg-[#1a1a1a]"
        >
          <option value="">All plans</option>
          {PLAN_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] px-3 text-[13px] text-neutral-700 hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/[0.08] dark:text-neutral-200 dark:hover:bg-white/[0.05]"
        >
          <IconRefresh size={14} stroke={2} />
          Refresh
        </button>
        <div className="ml-auto flex items-center gap-2">
          <DepthButton
            variant="blue"
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() =>
              void runReset(
                { kind: "users", ids: [...selected] },
                "Selected",
              )
            }
            className="inline-flex h-9 items-center rounded-lg px-3 text-[13px] font-medium text-white disabled:opacity-50"
          >
            Reset selected ({selected.size})
          </DepthButton>
          <DepthButton
            variant="neutral"
            type="button"
            disabled={busy || !planFilter}
            onClick={() =>
              void runReset(
                { kind: "plan", plan: planFilter },
                `Plan ${planFilter}`,
              )
            }
            className="inline-flex h-9 items-center rounded-lg px-3 text-[13px] font-medium text-neutral-900 disabled:opacity-50 dark:text-neutral-100"
          >
            Reset plan
          </DepthButton>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmAll(true)}
            className="inline-flex h-9 items-center rounded-lg border border-red-300 px-3 text-[13px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            Reset all
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-black/[0.07] dark:border-white/[0.07]">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-black/[0.02] text-[12px] text-neutral-500 dark:bg-white/[0.03] dark:text-neutral-400">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </th>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 font-medium">Usage bal.</th>
              <th className="px-3 py-2 font-medium">Messages</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-8 text-center text-neutral-400"
                >
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-8 text-center text-neutral-400"
                >
                  No users on this page.
                </td>
              </tr>
            ) : (
              filtered.map((u) => (
                <tr
                  key={u.id}
                  className="border-t border-black/[0.05] dark:border-white/[0.05]"
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(u.id)}
                      onChange={() => toggleOne(u.id)}
                      aria-label={`Select ${u.email ?? u.id}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-neutral-800 dark:text-neutral-100">
                      {u.email ?? "—"}
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      {u.name ?? u.id}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[12px] text-neutral-600 dark:bg-white/[0.08] dark:text-neutral-300">
                      {u.plan}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-neutral-600 dark:text-neutral-300">
                    {fmtAmount(u.usageBalance)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-neutral-600 dark:text-neutral-300">
                    {fmtAmount(u.messagesBalance)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-[12px] text-neutral-500">
        <span>
          {total != null
            ? `${total} ${debouncedSearch || planFilter ? "matching" : "total"} users${
                truncated ? " (scan capped — refine the search)" : ""
              }`
            : `${users.length} shown`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={offset === 0 || loading}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            className="rounded-md px-2 py-1 hover:bg-black/[0.04] disabled:opacity-40 dark:hover:bg-white/[0.06]"
          >
            Prev
          </button>
          <span>Offset {offset}</span>
          <button
            type="button"
            disabled={loading || users.length < PAGE_SIZE}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            className="rounded-md px-2 py-1 hover:bg-black/[0.04] disabled:opacity-40 dark:hover:bg-white/[0.06]"
          >
            Next
          </button>
        </div>
      </div>

      {confirmAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#1a1a1a]">
            <h3 className="text-[15px] font-semibold">Reset all users?</h3>
            <p className="mt-2 text-[13px] text-neutral-500 dark:text-neutral-400">
              This zeroes the usage counter for every user, restoring their full
              allotment. This can't be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAll(false)}
                className="h-9 rounded-lg px-3 text-[13px] text-neutral-600 hover:bg-black/[0.04] dark:text-neutral-300 dark:hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirmAll(false);
                  void runReset({ kind: "all" }, "All users");
                }}
                className="h-9 rounded-lg bg-red-600 px-3 text-[13px] font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                Reset all
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// --- Usage-multiplier event section ----------------------------------------

function MultiplierSection() {
  const config = useQuery(getMultiplierConfigRef) as MultiplierConfig | undefined;
  const saveConfig = useMutation(setMultiplierConfigRef);

  const [enabled, setEnabled] = useState(false);
  const [multiplier, setMultiplier] = useState("0.5");
  const [headline, setHeadline] = useState("");
  const [subtext, setSubtext] = useState("");
  const [applyToFree, setApplyToFree] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Seed the form once when the config first loads.
  useEffect(() => {
    if (seeded || config === undefined) return;
    if (config) {
      setEnabled(config.enabled ?? false);
      setMultiplier(String(config.multiplier ?? 0.5));
      setHeadline(config.headline ?? "");
      setSubtext(config.subtext ?? "");
      setApplyToFree(config.applyToFreeMessages ?? false);
      setStartsAt(toLocalInput(config.startsAt));
      setExpiresAt(toLocalInput(config.expiresAt));
    }
    setSeeded(true);
  }, [config, seeded]);

  const multiplierNum = Number(multiplier);
  const previewLabel = Number.isFinite(multiplierNum)
    ? multiplierLabel(multiplierNum)
    : "—";

  const save = async () => {
    if (!Number.isFinite(multiplierNum) || multiplierNum <= 0) {
      showToast({
        message: "Multiplier must be a positive number",
        tone: "danger",
      });
      return;
    }
    setSaving(true);
    try {
      await saveConfig({
        multiplier: multiplierNum,
        headline: headline.trim(),
        subtext: subtext.trim() || undefined,
        applyToFreeMessages: applyToFree,
        startsAt: fromLocalInput(startsAt),
        expiresAt: fromLocalInput(expiresAt),
        enabled,
      });
      showToast({ message: "Multiplier event saved" });
    } catch (e) {
      showToast({
        message: e instanceof Error ? e.message : "Save failed",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <IconSparkles
          size={18}
          stroke={2}
          className="text-neutral-500"
        />
        <h2 className="text-[15px] font-semibold">Usage-multiplier event</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-black/[0.08] px-3 py-2.5 dark:border-white/[0.08]">
            <span className="text-[13px] font-medium">Event enabled</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4"
            />
          </label>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-neutral-500">
              Deduction multiplier ({previewLabel} usage)
            </label>
            <input
              type="number"
              step="0.05"
              min="0.05"
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
              className="h-9 w-full rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] outline-none focus:ring-2 focus:ring-[#178dfb]/30 dark:border-white/[0.08] dark:bg-[#1a1a1a]"
            />
            <p className="mt-1 text-[11px] text-neutral-400">
              Each prompt costs this fraction of usage. 0.5 ⇒ half cost ⇒ “2×
              usage”.
            </p>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-black/[0.08] px-3 py-2.5 dark:border-white/[0.08]">
            <span className="text-[13px] font-medium">
              Also scale free-tier messages
            </span>
            <input
              type="checkbox"
              checked={applyToFree}
              onChange={(e) => setApplyToFree(e.target.checked)}
              className="h-4 w-4"
            />
          </label>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-neutral-500">
              Banner headline
            </label>
            <input
              type="text"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="2× usage is live"
              className="h-9 w-full rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] outline-none focus:ring-2 focus:ring-[#178dfb]/30 dark:border-white/[0.08] dark:bg-[#1a1a1a]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-neutral-500">
              Banner subtext (optional)
            </label>
            <input
              type="text"
              value={subtext}
              onChange={(e) => setSubtext(e.target.value)}
              placeholder="Every prompt goes twice as far this week."
              className="h-9 w-full rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] outline-none focus:ring-2 focus:ring-[#178dfb]/30 dark:border-white/[0.08] dark:bg-[#1a1a1a]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-neutral-500">
                Starts (optional)
              </label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="h-9 w-full rounded-lg border border-black/[0.08] bg-white px-2 text-[13px] outline-none dark:border-white/[0.08] dark:bg-[#1a1a1a]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-neutral-500">
                Ends (optional)
              </label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="h-9 w-full rounded-lg border border-black/[0.08] bg-white px-2 text-[13px] outline-none dark:border-white/[0.08] dark:bg-[#1a1a1a]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div className="mt-5">
        <p className="mb-1.5 text-[12px] font-medium text-neutral-500">
          Banner preview
        </p>
        <div className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#0c82f2] to-[#0a6fd0] px-4 py-2 text-white">
          <IconSparkles
            size={15}
            stroke={2}
            className="opacity-90"
          />
          <p className="truncate text-[13px]">
            <span className="font-semibold">
              {headline || "Your headline here"}
            </span>
            {subtext ? <span className="ml-2 opacity-90">{subtext}</span> : null}
          </p>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <DepthButton
          variant="blue"
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="inline-flex h-9 items-center rounded-lg px-4 text-[13px] font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save event"}
        </DepthButton>
      </div>
    </section>
  );
}
