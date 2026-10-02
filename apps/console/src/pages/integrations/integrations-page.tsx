import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { IconPlus } from "@tabler/icons-react";

import { ConfirmModal } from "~/components/confirm-modal";
import { CONSOLE_EVENTS, useCapture } from "~/lib/analytics";
import { api, type Integration } from "~/lib/backend";
import {
  IntegrationTable,
  IntegrationTableSkeleton,
  IntegrationsEmptyState,
} from "~/pages/integrations/integration-table";

/**
 * The console's home: every MCP integration the signed-in developer has
 * registered for the store, with its review status and lifecycle actions.
 */
export function IntegrationsPage() {
  const integrations = useQuery(api.integrations.listMine);
  const setEnabled = useMutation(api.integrations.setEnabled);
  const removeIntegration = useMutation(api.integrations.remove);
  const capture = useCapture();
  const navigate = useNavigate();

  const [deleteTarget, setDeleteTarget] = useState<Integration | null>(null);

  const openCreate = () => void navigate("/integrations/new");

  const actions = {
    // Edits are full resubmissions — the form page handles them.
    onEdit: (integration: Integration) =>
      void navigate(`/integrations/${integration.id}/edit`),
    onToggle: (integration: Integration, enabled: boolean) => {
      capture(CONSOLE_EVENTS.integrationToggled, {
        authMode: integration.authMode,
        enabled,
      });
      // Fire and forget — the reactive query snaps the row back on failure.
      void setEnabled({ id: integration.id, enabled });
    },
    onDelete: setDeleteTarget,
  };

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            My Integrations
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
            MCP servers you've registered for the Whirl integration store.
          </p>
        </div>
        {integrations !== undefined && integrations.length > 0 && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-[13px] font-medium text-white transition hover:bg-blue-500"
          >
            <IconPlus size={15} stroke={2.5} />
            New integration
          </button>
        )}
      </div>

      <div className="mt-6">
        {integrations === undefined ? (
          <IntegrationTableSkeleton />
        ) : integrations.length === 0 ? (
          <IntegrationsEmptyState onCreate={openCreate} />
        ) : (
          <IntegrationTable integrations={integrations} actions={actions} />
        )}
      </div>

      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete integration?"
        body={`"${deleteTarget?.name ?? ""}" will be removed from the store pipeline and deleted for good. This can't be undone.`}
        confirmLabel="Delete"
        destructive
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await removeIntegration({ id: deleteTarget.id });
          capture(CONSOLE_EVENTS.integrationDeleted, {
            authMode: deleteTarget.authMode,
          });
        }}
      />
    </>
  );
}
