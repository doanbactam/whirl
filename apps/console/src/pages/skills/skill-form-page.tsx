import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { IconAlertTriangle, IconArrowLeft } from "@tabler/icons-react";

import { Skeleton } from "~/components/skeleton";
import { Spinner } from "~/components/spinner";
import { VerifiedBadge } from "~/components/verified-badge";
import { CONSOLE_EVENTS, useCapture } from "~/lib/analytics";
import { api, type Skill } from "~/lib/backend";
import { useIsAdmin } from "~/lib/use-admin";
import {
  inputClass,
  textareaClass,
} from "~/pages/integrations/auth-config-fields";
import {
  FieldLabel,
  ImageUploadField,
  SvgIconField,
  type UploadedImage,
} from "~/pages/integrations/branding-fields";

/** Mirrors MAX_SKILL_INSTRUCTIONS_LENGTH in convex/skills.ts. */
const MAX_INSTRUCTIONS = 100_000;

/** Create mode: a blank form that submits into the approvals queue. */
export function NewSkillPage() {
  return <SkillFormPage />;
}

/**
 * Edit mode: the same form, prefilled from the saved row. Everything is
 * editable — and saving sends the skill back through review.
 */
export function EditSkillPage() {
  const { id } = useParams();
  const skills = useQuery(api.skills.listMine);
  const navigate = useNavigate();

  if (skills === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }
  const initial = skills.find((s) => s.id === id);
  if (!initial) {
    void navigate("/skills", { replace: true });
    return null;
  }
  return <SkillFormPage initial={initial} />;
}

/**
 * Registration form for a store skill: branding plus the instruction text
 * itself. Submits (or resubmits) into the admin approvals queue — the same
 * one integrations go through.
 */
function SkillFormPage({ initial }: { initial?: Skill }) {
  const createSkill = useMutation(api.skills.create);
  const updateSkill = useMutation(api.skills.update);
  const capture = useCapture();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const editing = initial !== undefined;

  const [name, setName] = useState(initial?.name ?? "");
  const [author, setAuthor] = useState(initial?.author ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [logo, setLogo] = useState<UploadedImage | null>(
    initial?.logoUrl ? { previewUrl: initial.logoUrl } : null,
  );
  const [banner, setBanner] = useState<UploadedImage | null>(
    initial?.bannerUrl ? { previewUrl: initial.bannerUrl } : null,
  );
  const [iconSvg, setIconSvg] = useState<string | null>(
    initial?.iconSvg ?? null,
  );
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claimsWhirl = author.trim().toLowerCase() === "whirl";

  const validate = (): string | null => {
    if (!name.trim()) return "Give the skill a name.";
    if (!author.trim()) return "Who made this skill?";
    if (!logo) return "Upload a logo for the store listing.";
    if (!description.trim()) {
      return "Write a description — it's how Whirl decides when to load the skill.";
    }
    if (!instructions.trim()) return "Paste the skill's instructions.";
    if (instructions.length > MAX_INSTRUCTIONS) {
      return `The skill text is too long — keep it under ${MAX_INSTRUCTIONS.toLocaleString("en-US")} characters.`;
    }
    return null;
  };

  const submit = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const shared = {
      name,
      description: description.trim() || undefined,
      author,
      iconSvg: iconSvg ?? undefined,
      instructions,
    };
    try {
      if (editing) {
        await updateSkill({
          ...shared,
          id: initial.id,
          // Branding ids ride along only when replaced; clear flags drop the
          // optional ones entirely.
          logoId: logo?.storageId,
          bannerId: banner?.storageId,
          clearBanner: banner === null,
          clearIcon: iconSvg === null,
        });
        capture(CONSOLE_EVENTS.skillUpdated, {
          length: instructions.length,
        });
      } else {
        await createSkill({
          ...shared,
          logoId: logo!.storageId!,
          bannerId: banner?.storageId,
        });
        capture(CONSOLE_EVENTS.skillCreated, {
          length: instructions.length,
          hasIcon: iconSvg !== null,
          hasBanner: banner !== null,
        });
      }
      void navigate("/skills");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <>
      <Link
        to="/skills"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-500 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <IconArrowLeft size={14} stroke={2} />
        Back to My Skills
      </Link>

      <div className="mt-4">
        <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {editing ? `Edit ${initial.name}` : "New skill"}
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
          {editing
            ? "Change anything you like — saving sends it back through review."
            : "Write instructions Whirl learns mid-chat. It goes live in the store once an admin approves it."}
        </p>
      </div>

      {editing && initial.status === "approved" && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-500/[0.08] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-800 dark:bg-amber-500/[0.12] dark:text-amber-200">
          <IconAlertTriangle size={15} stroke={2} className="mt-0.5 shrink-0" />
          This skill is live. Saving edits returns it to pending review, so it
          leaves the store until an admin approves it again.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-4">
        <FormSection
          title="Details"
          subtitle="What users see in the store listing. The description doubles as Whirl's cue for when to reach for this skill — make it say what the skill is for."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <FieldLabel label="Name" />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Cover Letter Coach"
                maxLength={60}
                autoFocus={!editing}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <FieldLabel label="Author" />
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="e.g. Acme Inc."
                maxLength={60}
                className={inputClass}
              />
              {claimsWhirl &&
                (isAdmin ? (
                  <span className="flex items-center gap-1 text-[11.5px] text-[#0c82f2]">
                    <VerifiedBadge size={13} />
                    This will publish as verified.
                  </span>
                ) : (
                  <span className="text-[11.5px] text-neutral-400 dark:text-neutral-500">
                    Heads up: only Whirl team accounts get the verified badge.
                  </span>
                ))}
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <FieldLabel label="Description" />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder='One or two lines on what this skill helps with, e.g. "Writing sharp, personal cover letters".'
              maxLength={240}
              rows={2}
              className={textareaClass}
            />
          </label>
        </FormSection>

        <FormSection
          title="Branding"
          subtitle="The logo is front and center in the store; the icon and banner are nice-to-haves."
        >
          <div className="flex flex-wrap gap-8">
            <ImageUploadField
              label="Logo"
              hint="Square works best. Shown on the store card and listing."
              shape="square"
              value={logo}
              onChange={setLogo}
            />
            <SvgIconField value={iconSvg} onChange={setIconSvg} />
          </div>
          <ImageUploadField
            label="Banner"
            hint="A wide header image for the store listing page."
            optional
            shape="banner"
            value={banner}
            onChange={setBanner}
          />
        </FormSection>

        <FormSection
          title="The skill"
          subtitle="The instructions Whirl follows once it loads the skill. Paste the whole thing — structure, examples, edge cases and all."
        >
          <label className="flex flex-col gap-1.5">
            <FieldLabel label="Instructions" />
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={
                "You are helping the user write a cover letter.\n\n1. Ask for the job posting first...\n2. Mirror the posting's language...\n3. Keep it under one page..."
              }
              rows={16}
              spellCheck={false}
              className={`${textareaClass} min-h-[280px] font-mono text-[12px] leading-relaxed`}
            />
            <span
              className={`self-end text-[11.5px] tabular-nums ${
                instructions.length > MAX_INSTRUCTIONS
                  ? "text-red-600 dark:text-red-400"
                  : "text-neutral-400 dark:text-neutral-500"
              }`}
            >
              {instructions.length.toLocaleString("en-US")} /{" "}
              {MAX_INSTRUCTIONS.toLocaleString("en-US")}
            </span>
          </label>
        </FormSection>

        {error && (
          <p className="rounded-lg bg-red-500/[0.08] px-3 py-2 text-[12.5px] text-red-700 dark:bg-red-500/[0.12] dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pb-4">
          <Link
            to="/skills"
            className="inline-flex h-9 items-center rounded-lg border border-black/[0.08] bg-white px-3.5 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
          >
            Cancel
          </Link>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-[13px] font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            {busy && <Spinner size={13} />}
            {editing ? "Save & resubmit for review" : "Submit for review"}
          </button>
        </div>
      </div>
    </>
  );
}

function FormSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.06] dark:bg-[#1B1B1B]">
      <div>
        <h2 className="text-[14px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {title}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-neutral-500 dark:text-neutral-400">
          {subtitle}
        </p>
      </div>
      {children}
    </section>
  );
}
