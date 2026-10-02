import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAction, useQuery } from "convex/react";
import { IconArrowLeft, IconSearch } from "@tabler/icons-react";

import { Skeleton } from "~/components/skeleton";
import { Spinner } from "~/components/spinner";
import { CONSOLE_EVENTS, useCapture } from "~/lib/analytics";
import {
  api,
  type AiModel,
  type DetectedModel,
  type ModelTierKey,
} from "~/lib/backend";
import { inputClass } from "~/pages/integrations/auth-config-fields";
import { FieldLabel } from "~/pages/integrations/branding-fields";
import { CapabilityPills } from "./capability-pills";
import { tierPreset, type TierPreset } from "./tier-data";

/** Create mode: add a custom model to the composer's search list. */
export function NewModelPage() {
  return <ModelFormPage />;
}

/** Edit mode: the same form, prefilled from the saved custom model. */
export function EditModelPage() {
  const { id } = useParams();
  const models = useQuery(api.models.listAll);
  const navigate = useNavigate();

  if (models === undefined) return <FormPageSkeleton />;
  const initial = models.find(
    (model) => model.id === id && model.tier === undefined,
  );
  if (!initial) {
    void navigate("/models", { replace: true });
    return null;
  }
  return <ModelFormPage initial={initial} />;
}

/**
 * Tier mode: point a preset tier (Free/Fast/Heavy/Image) at a different
 * OpenRouter model. Prefilled from the active override when one exists.
 */
export function CustomizeTierPage() {
  const { tier } = useParams();
  const models = useQuery(api.models.listAll);
  const navigate = useNavigate();

  const preset = tier ? tierPreset(tier as ModelTierKey) : undefined;
  if (!preset) {
    void navigate("/models", { replace: true });
    return null;
  }
  if (models === undefined) return <FormPageSkeleton />;
  const initial = models.find((model) => model.tier === preset.key);
  return <ModelFormPage initial={initial} preset={preset} />;
}

/**
 * One form for all three modes. The OpenRouter slug is the anchor: Detect
 * looks it up, previews the capabilities, and prefills the names — and the
 * save re-detects server-side regardless, so a bogus slug can never land.
 */
function ModelFormPage({
  initial,
  preset,
}: {
  initial?: AiModel;
  preset?: TierPreset;
}) {
  const createModel = useAction(api.models.create);
  const updateModel = useAction(api.models.update);
  const detectModel = useAction(api.models.detect);
  const capture = useCapture();
  const navigate = useNavigate();
  const tierMode = preset !== undefined;
  const editing = initial !== undefined;

  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [displayName, setDisplayName] = useState(
    initial?.displayName ?? preset?.label ?? "",
  );
  const [company, setCompany] = useState(initial?.company ?? "");
  const [modelName, setModelName] = useState(initial?.modelName ?? "");
  const [detected, setDetected] = useState<DetectedModel | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The capabilities worth previewing: a fresh detection for the slug as
  // typed, or the saved row's when the slug hasn't moved.
  const preview =
    detected && detected.slug === slug.trim()
      ? detected.capabilities
      : !detected && initial && initial.slug === slug.trim()
        ? initial.capabilities
        : null;

  const detect = async () => {
    if (!slug.trim()) {
      setDetectError("Enter an OpenRouter slug first.");
      return;
    }
    setDetecting(true);
    setDetectError(null);
    try {
      const result = await detectModel({ slug });
      setDetected(result);
      setSlug(result.slug);
      // Prefill anything still blank — detected names are suggestions, not
      // overwrites.
      if (!company.trim()) setCompany(result.company);
      if (!modelName.trim()) setModelName(result.modelName);
      if (!displayName.trim()) setDisplayName(result.modelName);
      capture(CONSOLE_EVENTS.modelDetected, { slug: result.slug });
    } catch (e) {
      setDetectError(
        e instanceof Error ? e.message : "Couldn't look that up.",
      );
    } finally {
      setDetecting(false);
    }
  };

  const validate = (): string | null => {
    if (!slug.trim()) return "Enter the OpenRouter slug.";
    if (!displayName.trim()) return "Give the model a display name.";
    if (!company.trim()) return "Who makes this model?";
    if (!modelName.trim()) return "What's the model called?";
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
      slug: slug.trim(),
      displayName: displayName.trim(),
      company: company.trim(),
      modelName: modelName.trim(),
    };
    try {
      if (tierMode) {
        // Tiers upsert through create — one override per tier, replaced on
        // every save.
        await createModel({
          ...shared,
          tier: preset.key,
        });
        capture(CONSOLE_EVENTS.modelTierCustomized, {
          tier: preset.key,
          slug: shared.slug,
        });
      } else if (editing) {
        await updateModel({
          ...shared,
          id: initial.id,
        });
        capture(CONSOLE_EVENTS.modelUpdated, { slug: shared.slug });
      } else {
        await createModel(shared);
        capture(CONSOLE_EVENTS.modelCreated, {
          slug: shared.slug,
        });
      }
      void navigate("/models");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <>
      <Link
        to="/models"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-500 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <IconArrowLeft size={14} stroke={2} />
        Back to Models
      </Link>

      <div className="mt-4">
        <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {tierMode
            ? `Customize ${preset.label}`
            : editing
              ? `Edit ${initial.displayName}`
              : "New model"}
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
          {tierMode
            ? `Point the ${preset.label} tier at a different OpenRouter model. It takes effect on the next message, everywhere.`
            : editing
              ? "Change anything you like — capabilities re-detect on save."
              : "Add an OpenRouter model to the composer's search list in the new app."}
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <FormSection
          title="OpenRouter"
          subtitle="The slug is the source of truth — capabilities are detected from it, never typed in."
        >
          <div className="flex flex-col gap-1.5">
            <FieldLabel label="Model slug" />
            <div className="flex gap-2">
              <input
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setDetectError(null);
                }}
                placeholder={preset?.defaultSlug ?? "anthropic/claude-fable-5"}
                maxLength={120}
                autoFocus={!editing}
                className={`${inputClass} font-mono text-[12px]`}
              />
              <button
                type="button"
                disabled={detecting}
                onClick={() => void detect()}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3.5 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 disabled:opacity-60 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
              >
                {detecting ? <Spinner size={13} /> : <IconSearch size={14} stroke={2} />}
                Detect
              </button>
            </div>
            {detectError && (
              <p className="text-[12px] text-red-600 dark:text-red-400">
                {detectError}
              </p>
            )}
          </div>
          {preview ? (
            <div className="flex flex-col gap-1.5">
              <FieldLabel label="Detected capabilities" />
              <CapabilityPills capabilities={preview} />
              {detected?.description && (
                <p className="line-clamp-3 text-[12px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                  {detected.description}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-neutral-400 dark:text-neutral-500">
              {slug.trim()
                ? "Capabilities will be detected from this slug when you save — hit Detect to preview them now."
                : "Enter a slug and hit Detect to preview what the model can do."}
            </p>
          )}
        </FormSection>

        <FormSection
          title="Details"
          subtitle={
            tierMode
              ? "The display name is what the composer shows for this tier."
              : "The display name is what the composer shows in the search list."
          }
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <FieldLabel label="Display name" />
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={preset?.label ?? "e.g. Claude"}
                maxLength={60}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <FieldLabel label="Provider" />
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="e.g. Anthropic"
                maxLength={60}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <FieldLabel label="Model name" />
              <input
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="e.g. Claude Fable 5"
                maxLength={60}
                className={inputClass}
              />
            </label>
          </div>
          <p className="text-[11.5px] text-neutral-400 dark:text-neutral-500">
            Icons are shared per provider and managed from the Models page.
          </p>
        </FormSection>

        {error && (
          <p className="rounded-lg bg-red-500/[0.08] px-3 py-2 text-[12.5px] text-red-700 dark:bg-red-500/[0.12] dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pb-4">
          <Link
            to="/models"
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
            {tierMode
              ? initial
                ? "Save tier override"
                : "Customize tier"
              : editing
                ? "Save changes"
                : "Add model"}
          </button>
        </div>
      </div>
    </>
  );
}

function FormPageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
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
