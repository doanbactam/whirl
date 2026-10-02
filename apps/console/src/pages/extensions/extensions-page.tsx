import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";

import { ConfirmModal } from "~/components/confirm-modal";
import { CONSOLE_EVENTS, useCapture } from "~/lib/analytics";
import { api, type ComposioExtension } from "~/lib/backend";
import { AddedExtensions } from "~/pages/extensions/added-extensions";
import { ToolkitCatalog } from "~/pages/extensions/toolkit-catalog";

/**
 * Admin-only curation of Composio extensions. Search Composio's toolkit
 * catalog, add the ones worth having, and they land here as drafts —
 * touch up the copy, then flip them live onto the integration store.
 */
export function ExtensionsPage() {
  const added = useQuery(api.composio.listAdded);
  const removeToolkit = useAction(api.composio.removeToolkit);
  // Composio listings are regular integrations rows owned by the admin who
  // added them, so the standard enable toggle is the publish switch.
  const setEnabled = useMutation(api.integrations.setEnabled);
  const capture = useCapture();

  const [removeTarget, setRemoveTarget] = useState<ComposioExtension | null>(
    null,
  );

  const toggle = (extension: ComposioExtension, enabled: boolean) => {
    capture(CONSOLE_EVENTS.composioToolkitToggled, {
      slug: extension.slug,
      enabled,
    });
    // Fire and forget — the reactive query snaps the row back on failure.
    void setEnabled({ id: extension.id, enabled });
  };

  const addedSlugs = new Set((added ?? []).map((extension) => extension.slug));

  return (
    <>
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Extensions
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
          Hand-picked Composio toolkits for the integration store. New ones
          arrive as drafts — polish the copy in My Integrations, then flip
          them live here.
        </p>
      </div>

      <section className="mt-6">
        <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Your extensions
        </h2>
        <div className="mt-3">
          <AddedExtensions
            added={added}
            onToggle={toggle}
            onRemove={setRemoveTarget}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Browse the catalog
        </h2>
        <div className="mt-3">
          <ToolkitCatalog addedSlugs={addedSlugs} />
        </div>
      </section>

      <ConfirmModal
        open={removeTarget !== null}
        title="Remove extension?"
        body={`"${removeTarget?.name ?? ""}" comes off the store and its Composio server is torn down. Anyone who installed it keeps a dead entry until they remove it themselves.`}
        confirmLabel="Remove"
        destructive
        onClose={() => setRemoveTarget(null)}
        onConfirm={async () => {
          if (!removeTarget) return;
          await removeToolkit({ id: removeTarget.id });
          capture(CONSOLE_EVENTS.composioToolkitRemoved, {
            slug: removeTarget.slug,
          });
        }}
      />
    </>
  );
}
