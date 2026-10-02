import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { IconFileUpload, IconPlus } from "@tabler/icons-react";

import { ConfirmModal } from "~/components/confirm-modal";
import { CONSOLE_EVENTS, useCapture } from "~/lib/analytics";
import { api, type AiModel } from "~/lib/backend";
import { ModelImportModal } from "./model-import-modal";
import { ModelTable, ModelTableSkeleton, ModelsEmptyState } from "./model-table";
import { PresetTiers, PresetTiersSkeleton } from "./preset-tiers";
import { ProviderIcons } from "./provider-icons";
import { tierPreset } from "./tier-data";

/**
 * The admin Models tab: the preset tier lineup up top (customize what model
 * serves each tier), and the custom catalog below (extra OpenRouter models
 * that join the new app's composer search list).
 */
export function ModelsPage() {
  const models = useQuery(api.models.listAll);
  const providers = useQuery(api.models.listProviders);
  const access = useQuery(api.models.tierAccess);
  const setEnabled = useMutation(api.models.setEnabled);
  const setLegacy = useMutation(api.models.setLegacy);
  const setTierRestricted = useMutation(api.models.setTierRestricted);
  const removeModel = useMutation(api.models.remove);
  const capture = useCapture();
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<AiModel | null>(null);
  const [resetTarget, setResetTarget] = useState<AiModel | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const accessControls = {
    restrictedTiers: access ? new Set(access.restrictedTiers) : null,
    onAccessChange: (tier: string, restricted: boolean) => {
      capture(CONSOLE_EVENTS.modelTierAccessChanged, { tier, restricted });
      void setTierRestricted({ tier, restricted });
    },
  };

  const overrides = (models ?? []).filter((model) => model.tier !== undefined);
  const customModels = (models ?? []).filter(
    (model) => model.tier === undefined,
  );

  const actions = {
    onEdit: (model: AiModel) => void navigate(`/models/${model.id}/edit`),
    onToggle: (model: AiModel, enabled: boolean) => {
      capture(CONSOLE_EVENTS.modelToggled, { slug: model.slug, enabled });
      void setEnabled({ id: model.id, enabled });
    },
    onLegacyToggle: (model: AiModel, legacy: boolean) => {
      capture(CONSOLE_EVENTS.modelLegacyToggled, { slug: model.slug, legacy });
      void setLegacy({ id: model.id, legacy });
    },
    onDelete: setDeleteTarget,
  };

  const openCreate = () => void navigate("/models/new");

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Models
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
            What serves each preset tier, plus the custom models in the
            composer's search list.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3.5 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
          >
            <IconFileUpload size={15} stroke={2} />
            Import JSON
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-[13px] font-medium text-white transition hover:bg-blue-500"
          >
            <IconPlus size={15} stroke={2.5} />
            New model
          </button>
        </div>
      </div>

      {notice && (
        <p className="mt-4 rounded-lg bg-emerald-500/[0.08] px-3 py-2 text-[12.5px] text-emerald-700 dark:bg-emerald-500/[0.12] dark:text-emerald-300">
          {notice}
        </p>
      )}

      <h2 className="mt-8 text-[14px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        Preset tiers
      </h2>
      <p className="mt-0.5 text-[12.5px] text-neutral-500 dark:text-neutral-400">
        Point a tier at a different OpenRouter model — no deploy needed. The
        switch decides who gets it: paid-only tiers show free users a lock
        and an upgrade prompt.
      </p>
      <div className="mt-3">
        {models === undefined ? (
          <PresetTiersSkeleton />
        ) : (
          <PresetTiers
            overrides={overrides}
            onReset={setResetTarget}
            access={accessControls}
          />
        )}
      </div>

      <h2 className="mt-8 text-[14px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        Provider icons
      </h2>
      <p className="mt-0.5 text-[12.5px] text-neutral-500 dark:text-neutral-400">
        Set one monochrome SVG per provider. Every matching model uses it
        automatically.
      </p>
      <div className="mt-3">
        <ProviderIcons providers={providers} />
      </div>

      <h2 className="mt-8 text-[14px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        Custom models
      </h2>
      <p className="mt-0.5 text-[12.5px] text-neutral-500 dark:text-neutral-400">
        Extra models users can pick from the composer's search list in the new
        app. The status switch hides a model without deleting it; the legacy
        switch keeps it search-only — off the browse list, still findable by
        name.
      </p>
      <div className="mt-3">
        {models === undefined ? (
          <ModelTableSkeleton />
        ) : customModels.length === 0 ? (
          <ModelsEmptyState onCreate={openCreate} />
        ) : (
          <ModelTable models={customModels} actions={actions} />
        )}
      </div>

      <ConfirmModal
        open={deleteTarget !== null}
        title={`Delete ${deleteTarget?.displayName ?? "this model"}?`}
        body="It disappears from the composer's search list immediately. Anyone who had it selected falls back to the default model."
        confirmLabel="Delete model"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          await removeModel({ id: deleteTarget.id });
          capture(CONSOLE_EVENTS.modelDeleted, { slug: deleteTarget.slug });
        }}
        onClose={() => setDeleteTarget(null)}
      />

      <ConfirmModal
        open={resetTarget !== null}
        title={`Reset ${
          resetTarget?.tier ? (tierPreset(resetTarget.tier)?.label ?? "this tier") : "this tier"
        } to default?`}
        body={`The tier goes back to its built-in model${
          resetTarget ? ` instead of ${resetTarget.slug}` : ""
        }. Takes effect on the next message.`}
        confirmLabel="Reset tier"
        onConfirm={async () => {
          if (!resetTarget) return;
          await removeModel({ id: resetTarget.id });
          capture(CONSOLE_EVENTS.modelTierReset, {
            tier: resetTarget.tier,
            slug: resetTarget.slug,
          });
        }}
        onClose={() => setResetTarget(null)}
      />

      <ModelImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(count) => {
          setImportOpen(false);
          setNotice(
            `Added ${count} model${count === 1 ? "" : "s"}. Provider icons are ready below.`,
          );
        }}
      />
    </>
  );
}
