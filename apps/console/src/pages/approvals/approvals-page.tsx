import { Link } from "react-router";
import { useQuery } from "convex/react";
import {
  IconChevronRight,
  IconRosetteDiscountCheck,
  IconSchool,
} from "@tabler/icons-react";

import { Skeleton } from "~/components/skeleton";
import { VerifiedBadge } from "~/components/verified-badge";
import {
  api,
  type IntegrationRequest,
  type SkillRequest,
} from "~/lib/backend";
import { formatDate } from "~/lib/format";

/** One merged queue entry — an integration or a skill, oldest first. */
type QueueEntry =
  | { kind: "integration"; request: IntegrationRequest }
  | { kind: "skill"; request: SkillRequest };

/**
 * Admin-only queue of pending requests — integrations and skills share it,
 * merged oldest-first with a type badge. Each row opens its detailed review
 * view (/approvals/:id for integrations, /approvals/skills/:id for skills).
 */
export function ApprovalsPage() {
  const requests = useQuery(api.integrations.listPendingRequests);
  const skillRequests = useQuery(api.skills.listPendingRequests);

  const loading = requests === undefined || skillRequests === undefined;
  const entries: QueueEntry[] = loading
    ? []
    : [
        ...requests.map(
          (request) => ({ kind: "integration", request }) as const,
        ),
        ...skillRequests.map(
          (request) => ({ kind: "skill", request }) as const,
        ),
      ].sort((a, b) => a.request.createdAt - b.request.createdAt);

  return (
    <>
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Approvals
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
          Integration and skill requests waiting for a decision.
        </p>
      </div>

      <div className="mt-6">
        {loading ? (
          <ApprovalsSkeleton />
        ) : entries.length === 0 ? (
          <ApprovalsEmptyState />
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) =>
              entry.kind === "integration" ? (
                <IntegrationRow key={entry.request.id} request={entry.request} />
              ) : (
                <SkillRow key={entry.request.id} request={entry.request} />
              ),
            )}
          </ul>
        )}
      </div>
    </>
  );
}

/** The shared row shell: logo, name line, meta line, badges, chevron. */
function RequestRow({
  to,
  logoUrl,
  fallbackIcon,
  name,
  verified,
  author,
  meta,
  typeBadge,
  trailingBadge,
}: {
  to: string;
  logoUrl: string | null;
  fallbackIcon: React.ReactNode;
  name: string;
  verified: boolean;
  author?: string;
  meta: string;
  typeBadge: string;
  trailingBadge: string;
}) {
  return (
    <li>
      <Link
        to={to}
        className="group flex items-center gap-4 rounded-2xl border border-black/[0.06] bg-white p-4 transition hover:border-black/[0.12] dark:border-white/[0.06] dark:bg-[#1B1B1B] dark:hover:border-white/[0.14]"
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-lg border border-black/[0.06] object-cover dark:border-white/[0.08]"
          />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-neutral-400 dark:bg-white/[0.06] dark:text-neutral-500">
            {fallbackIcon}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 truncate text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
            {name}
            {verified && <VerifiedBadge size={14} />}
            {author && (
              <span className="font-normal text-neutral-400 dark:text-neutral-500">
                by {author}
              </span>
            )}
          </span>
          <span className="truncate text-[12px] text-neutral-500 dark:text-neutral-400">
            {meta}
          </span>
        </div>
        <span className="rounded-full bg-blue-500/[0.08] px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-400/[0.12] dark:text-blue-300">
          {typeBadge}
        </span>
        <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:bg-white/[0.06] dark:text-neutral-400">
          {trailingBadge}
        </span>
        <IconChevronRight
          size={16}
          stroke={2}
          className="shrink-0 text-neutral-400 transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </li>
  );
}

function IntegrationRow({ request }: { request: IntegrationRequest }) {
  const requester =
    request.requestedByName || request.requestedByEmail || request.userId;
  return (
    <RequestRow
      to={`/approvals/${request.id}`}
      logoUrl={request.logoUrl}
      fallbackIcon={<IconRosetteDiscountCheck size={16} stroke={1.8} />}
      name={request.name}
      verified={request.verified}
      author={request.author}
      meta={`Requested by ${requester} · ${formatDate(request.createdAt)} · ${request.tools.length} tools`}
      typeBadge="Integration"
      trailingBadge={
        request.authMode === "apiKey"
          ? "API key"
          : request.authMode === "oauth"
            ? "OAuth"
            : "No auth"
      }
    />
  );
}

function SkillRow({ request }: { request: SkillRequest }) {
  const requester =
    request.requestedByName || request.requestedByEmail || request.userId;
  return (
    <RequestRow
      to={`/approvals/skills/${request.id}`}
      logoUrl={request.logoUrl}
      fallbackIcon={<IconSchool size={16} stroke={1.8} />}
      name={request.name}
      verified={request.verified}
      author={request.author}
      meta={`Requested by ${requester} · ${formatDate(request.createdAt)}`}
      typeBadge="Skill"
      trailingBadge={`${request.instructions.length.toLocaleString("en-US")} chars`}
    />
  );
}

function ApprovalsSkeleton() {
  return (
    <ul className="flex flex-col gap-2">
      {Array.from({ length: 2 }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-4 rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/[0.06] dark:bg-[#1B1B1B]"
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-44" />
            <Skeleton className="h-2.5 w-64" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

function ApprovalsEmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-black/[0.06] bg-white px-6 py-14 text-center dark:border-white/[0.06] dark:bg-[#1B1B1B]">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/[0.05] text-neutral-700 dark:bg-white/[0.08] dark:text-neutral-200">
        <IconRosetteDiscountCheck size={22} stroke={1.8} />
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          All clear
        </h3>
        <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          No requests waiting for review. New integrations and skills show up
          here the moment a developer submits them.
        </p>
      </div>
    </div>
  );
}
