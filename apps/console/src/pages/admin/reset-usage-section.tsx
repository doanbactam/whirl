import { useCallback, useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import { IconRefresh, IconUsersGroup } from "@tabler/icons-react";

import { ConfirmModal } from "~/components/confirm-modal";
import { Spinner } from "~/components/spinner";
import { api } from "~/lib/backend";
import { userErrorMessage } from "~/lib/errors";
import {
  formatAmount,
  PAGE_SIZE,
  PLAN_OPTIONS,
  type ListedUser,
  type ResetTarget,
} from "./admin-types";

const fieldClass =
  "h-9 rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] text-neutral-900 outline-none transition focus:border-blue-500/40 focus:ring-2 focus:ring-blue-500/15 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100";

export function ResetUsageSection() {
  const listUsers = useAction(api.admin.listUsers);
  const resetUsage = useAction(api.admin.resetUsage);

  const [users, setUsers] = useState<ListedUser[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [planFilter, setPlanFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0);
      setDebouncedSearch(search.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listUsers({
        limit: PAGE_SIZE,
        offset,
        plan: planFilter || undefined,
        search: debouncedSearch || undefined,
      });
      setUsers(result.users);
      setTotal(result.total);
      setTruncated(result.truncated);
      setSelected(new Set());
    } catch (cause) {
      setError(userErrorMessage(cause, "Couldn't load customer usage."));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, listUsers, offset, planFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter(
      (user) =>
        (user.email ?? "").toLowerCase().includes(query) ||
        (user.name ?? "").toLowerCase().includes(query) ||
        user.id.toLowerCase().includes(query),
    );
  }, [search, users]);

  const allSelected =
    filteredUsers.length > 0 &&
    filteredUsers.every((user) => selected.has(user.id));

  const toggleAll = () => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (filteredUsers.every((user) => previous.has(user.id))) {
        for (const user of filteredUsers) next.delete(user.id);
      } else {
        for (const user of filteredUsers) next.add(user.id);
      }
      return next;
    });
  };

  const toggleUser = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runReset = async (
    target: ResetTarget,
    label: string,
    throwOnError = false,
  ) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await resetUsage({
        target,
        message: resetMessage.trim() || undefined,
      });
      const failed = result.failed.length
        ? ` ${result.failed.length} failed.`
        : "";
      const capped = result.truncated
        ? " The customer scan hit its safety cap."
        : "";
      setNotice(
        `${label}: reset ${result.succeeded} of ${result.total}.${failed}${capped}`,
      );
      await load();
    } catch (cause) {
      const message = userErrorMessage(cause, "Couldn't reset usage.");
      setError(message);
      if (throwOnError) throw new Error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-black/[0.07] bg-white/55 p-5 dark:border-white/[0.07] dark:bg-white/[0.025]">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-blue-600 dark:text-blue-400">
          <IconUsersGroup size={17} stroke={2} />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Reset usage quotas
          </h2>
          <p className="mt-0.5 text-[12.5px] text-neutral-500 dark:text-neutral-400">
            Refill selected customers, a whole plan, or everyone.
          </p>
        </div>
      </div>

      <label className="mt-5 block">
        <span className="mb-1 block text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
          Message shown after reset
        </span>
        <input
          type="text"
          value={resetMessage}
          onChange={(event) => setResetMessage(event.target.value)}
          placeholder="Lucky you — your usage quota just got a fresh reset."
          className={`${fieldClass} w-full`}
        />
        <span className="mt-1 block text-[11px] text-neutral-400">
          Optional. Leave blank to give each customer a playful default.
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search email, name, or ID…"
          className={`${fieldClass} w-60`}
        />
        <select
          value={planFilter}
          onChange={(event) => {
            setOffset(0);
            setPlanFilter(event.target.value);
          }}
          className={fieldClass}
          aria-label="Filter by plan"
        >
          <option value="">All plans</option>
          {PLAN_OPTIONS.map((plan) => (
            <option key={plan.value} value={plan.value}>
              {plan.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] font-medium text-neutral-700 transition hover:border-black/[0.16] hover:bg-neutral-100 disabled:opacity-50 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-200 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
        >
          {loading ? <Spinner size={13} /> : <IconRefresh size={14} stroke={2} />}
          Refresh
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() =>
              void runReset(
                { kind: "users", ids: [...selected] },
                "Selected customers",
              )
            }
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-[13px] font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {busy && <Spinner size={13} />}
            Reset selected ({selected.size})
          </button>
          <button
            type="button"
            disabled={busy || !planFilter}
            onClick={() =>
              void runReset(
                { kind: "plan", plan: planFilter },
                `${planFilter} plan`,
              )
            }
            className="inline-flex h-9 items-center rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] font-medium text-neutral-800 transition hover:border-black/[0.16] hover:bg-neutral-100 disabled:opacity-50 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
          >
            Reset plan
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmAll(true)}
            className="inline-flex h-9 items-center rounded-lg border border-red-500/30 px-3 text-[13px] font-medium text-red-600 transition hover:bg-red-500/[0.07] disabled:opacity-50 dark:text-red-400"
          >
            Reset all
          </button>
        </div>
      </div>

      {(notice || error) && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-[12.5px] ${
            error
              ? "bg-red-500/[0.08] text-red-700 dark:bg-red-500/[0.12] dark:text-red-300"
              : "bg-emerald-500/[0.08] text-emerald-700 dark:bg-emerald-500/[0.12] dark:text-emerald-300"
          }`}
        >
          {error ?? notice}
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-black/[0.07] dark:border-white/[0.07]">
        <table className="w-full min-w-[680px] text-left text-[13px]">
          <thead className="bg-black/[0.025] text-[12px] text-neutral-500 dark:bg-white/[0.035] dark:text-neutral-400">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all customers on this page"
                />
              </th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 font-medium">Usage balance</th>
              <th className="px-3 py-2 font-medium">Messages</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-9 text-center">
                  <Spinner size={16} className="text-neutral-400" />
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-9 text-center text-neutral-400"
                >
                  No customers found.
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <tr
                  key={user.id}
                  className="border-t border-black/[0.05] dark:border-white/[0.05]"
                >
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(user.id)}
                      onChange={() => toggleUser(user.id)}
                      aria-label={`Select ${user.email ?? user.id}`}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-neutral-800 dark:text-neutral-100">
                      {user.email ?? "No email"}
                    </div>
                    <div className="mt-0.5 text-[11px] text-neutral-400">
                      {user.name ?? user.id}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[12px] text-neutral-600 dark:bg-white/[0.08] dark:text-neutral-300">
                      {user.plan}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-neutral-600 dark:text-neutral-300">
                    {formatAmount(user.usageBalance)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-neutral-600 dark:text-neutral-300">
                    {formatAmount(user.messagesBalance)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-[12px] text-neutral-500 dark:text-neutral-400">
        <span>
          {total !== null
            ? `${total} ${
                debouncedSearch || planFilter ? "matching" : "total"
              } customers${truncated ? " · scan capped" : ""}`
            : `${users.length} shown`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={offset === 0 || loading}
            onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
            className="rounded-md px-2 py-1 transition hover:bg-black/[0.04] disabled:opacity-40 dark:hover:bg-white/[0.06]"
          >
            Previous
          </button>
          <span className="tabular-nums">Offset {offset}</span>
          <button
            type="button"
            disabled={loading || users.length < PAGE_SIZE}
            onClick={() => setOffset((current) => current + PAGE_SIZE)}
            className="rounded-md px-2 py-1 transition hover:bg-black/[0.04] disabled:opacity-40 dark:hover:bg-white/[0.06]"
          >
            Next
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmAll}
        title="Reset every customer's usage?"
        body="This restores every customer's full allowance and cannot be undone. The operation is bounded by the backend safety cap."
        confirmLabel="Reset everyone"
        destructive
        onClose={() => setConfirmAll(false)}
        onConfirm={async () => {
          await runReset({ kind: "all" }, "All customers", true);
        }}
      />
    </section>
  );
}
