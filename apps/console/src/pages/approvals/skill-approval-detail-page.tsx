import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import {
  IconArrowLeft,
  IconCheck,
  IconSchool,
  IconX,
} from "@tabler/icons-react";

import { MonoIcon } from "~/components/mono-icon";
import { Skeleton } from "~/components/skeleton";
import { Spinner } from "~/components/spinner";
import { VerifiedBadge } from "~/components/verified-badge";
import { CONSOLE_EVENTS, useCapture } from "~/lib/analytics";
import { api, type SkillRequest } from "~/lib/backend";
import { formatDate } from "~/lib/format";

/**
 * Full review view for one skill request: branding as the store will show
 * it, the complete instruction text — and the decision itself: approve, or
 * deny with a reason. The skill sibling of ApprovalDetailPage.
 */
export function SkillApprovalDetailPage() {
  const { id } = useParams();
  const request = useQuery(api.skills.getRequest, { id: id ?? "" });

  return (
    <>
      <Link
        to="/approvals"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-500 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <IconArrowLeft size={14} stroke={2} />
        Back to Approvals
      </Link>

      <div className="mt-4">
        {request === undefined ? (
          <DetailSkeleton />
        ) : request === null ? (
          <NotFound />
        ) : (
          <RequestDetail request={request} />
        )}
      </div>
    </>
  );
}

function RequestDetail({ request }: { request: SkillRequest }) {
  return (
    <div className="flex flex-col gap-4">
      {request.bannerUrl && (
        <img
          src={request.bannerUrl}
          alt=""
          className="h-32 w-full rounded-2xl border border-black/[0.06] object-cover dark:border-white/[0.08]"
        />
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3.5">
          {request.logoUrl ? (
            <img
              src={request.logoUrl}
              alt=""
              className="h-12 w-12 rounded-xl border border-black/[0.06] object-cover dark:border-white/[0.08]"
            />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-black/[0.04] text-neutral-400 dark:bg-white/[0.06] dark:text-neutral-500">
              <IconSchool size={20} stroke={1.8} />
            </span>
          )}
          <div>
            <h1 className="flex items-center gap-1.5 text-[22px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              {request.name}
              {request.verified && <VerifiedBadge size={18} />}
            </h1>
            <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
              by {request.author || "Unknown author"}
              {request.iconSvg && (
                <span className="ml-2 inline-flex items-center gap-1 align-middle text-[11.5px]">
                  · icon <MonoIcon svg={request.iconSvg} size={13} />
                </span>
              )}
            </p>
          </div>
        </div>
        <StatusBadge status={request.status} />
      </div>

      {request.description && (
        <p className="max-w-xl text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300">
          {request.description}
        </p>
      )}

      <div className="rounded-2xl border border-black/[0.06] bg-white dark:border-white/[0.06] dark:bg-[#1B1B1B]">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 sm:grid-cols-3">
          <DetailField label="Requested by">
            {request.requestedByName || "Unknown"}
          </DetailField>
          <DetailField label="Email">
            {request.requestedByEmail || "—"}
          </DetailField>
          <DetailField label="Requested on">
            {formatDate(request.createdAt)}
          </DetailField>
          <DetailField label="Type">Skill</DetailField>
          <DetailField label="Length">
            {request.instructions.length.toLocaleString("en-US")} characters
          </DetailField>
          <DetailField label="User id">
            <span className="font-mono text-[11px] break-all">
              {request.userId}
            </span>
          </DetailField>
        </dl>
      </div>

      <div className="rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.06] dark:bg-[#1B1B1B]">
        <h2 className="text-[14px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Instructions
        </h2>
        <p className="mt-1 text-[12.5px] text-neutral-500 dark:text-neutral-400">
          This is the exact text handed to the model when it loads the skill —
          read it like a prompt injection reviewer: no exfiltration, no
          impersonation, nothing that overrides safety.
        </p>
        <pre className="mt-3 max-h-96 overflow-y-auto rounded-lg bg-black/[0.025] px-3.5 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-neutral-700 dark:bg-white/[0.04] dark:text-neutral-300">
          {request.instructions}
        </pre>
      </div>

      {request.status === "pending" ? (
        <ReviewCard request={request} />
      ) : (
        <ReviewOutcome request={request} />
      )}
    </div>
  );
}

function ReviewCard({ request }: { request: SkillRequest }) {
  const reviewRequest = useMutation(api.skills.reviewRequest);
  const capture = useCapture();
  const navigate = useNavigate();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "approve" | "deny") => {
    setBusy(decision);
    setError(null);
    try {
      await reviewRequest({
        id: request.id,
        decision,
        note: note.trim() || undefined,
      });
      capture(
        decision === "approve"
          ? CONSOLE_EVENTS.skillApproved
          : CONSOLE_EVENTS.skillDenied,
        { length: request.instructions.length },
      );
      void navigate("/approvals");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.06] dark:bg-[#1B1B1B]">
      <h2 className="text-[14px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        Review
      </h2>
      <p className="mt-1 text-[12.5px] text-neutral-500 dark:text-neutral-400">
        The note is shown to the requester. It's required for a denial,
        optional for an approval.
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Approved — clear, focused instructions / Denied — tries to override system behavior."
        maxLength={500}
        rows={3}
        className="mt-3 w-full resize-none rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-[13px] text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-[#0c82f2] focus:ring-2 focus:ring-[#0c82f2]/20 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:placeholder:text-neutral-500"
      />
      {error && (
        <p className="mt-3 rounded-lg bg-red-500/[0.08] px-3 py-2 text-[12.5px] text-red-700 dark:bg-red-500/[0.12] dark:text-red-300">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide("deny")}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-500/40 px-3.5 text-[13px] font-medium text-red-600 transition hover:bg-red-500/[0.06] disabled:opacity-50 dark:border-red-400/40 dark:text-red-400 dark:hover:bg-red-500/[0.1]"
        >
          {busy === "deny" ? (
            <Spinner size={13} />
          ) : (
            <IconX size={14} stroke={2.5} />
          )}
          Deny
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide("approve")}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-[13px] font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
        >
          {busy === "approve" ? (
            <Spinner size={13} />
          ) : (
            <IconCheck size={14} stroke={2.5} />
          )}
          Approve
        </button>
      </div>
    </div>
  );
}

function ReviewOutcome({ request }: { request: SkillRequest }) {
  const approved = request.status === "approved";
  return (
    <div
      className={`rounded-2xl border p-5 ${
        approved
          ? "border-emerald-500/25 bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06]"
          : "border-red-500/25 bg-red-500/[0.04] dark:bg-red-500/[0.06]"
      }`}
    >
      <h2
        className={`text-[14px] font-semibold tracking-tight ${
          approved
            ? "text-emerald-800 dark:text-emerald-300"
            : "text-red-800 dark:text-red-300"
        }`}
      >
        {approved ? "Approved" : "Denied"}
        {request.reviewedAt ? ` · ${formatDate(request.reviewedAt)}` : ""}
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300">
        {request.reviewNote || "No note was left."}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: SkillRequest["status"] }) {
  if (status === "approved") {
    return (
      <span className="rounded-full bg-emerald-500/[0.1] px-2.5 py-1 text-[11.5px] font-medium text-emerald-700 dark:bg-emerald-500/[0.15] dark:text-emerald-300">
        Approved
      </span>
    );
  }
  if (status === "denied") {
    return (
      <span className="rounded-full bg-red-500/[0.1] px-2.5 py-1 text-[11.5px] font-medium text-red-700 dark:bg-red-500/[0.15] dark:text-red-300">
        Denied
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-500/[0.12] px-2.5 py-1 text-[11.5px] font-medium text-amber-700 dark:bg-amber-500/[0.15] dark:text-amber-300">
      Pending review
    </span>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-[11.5px] font-medium text-neutral-400 dark:text-neutral-500">
        {label}
      </dt>
      <dd className="text-[13px] text-neutral-800 dark:text-neutral-200">
        {children}
      </dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3.5">
        <Skeleton className="h-12 w-12 rounded-xl" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
      <div className="rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.06] dark:bg-[#1B1B1B]">
        <div className="grid grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-3.5 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white px-6 py-14 text-center dark:border-white/[0.06] dark:bg-[#1B1B1B]">
      <h3 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        Request not found
      </h3>
      <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
        It may have been deleted by the requester.
      </p>
    </div>
  );
}
