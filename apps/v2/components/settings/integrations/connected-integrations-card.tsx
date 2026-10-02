"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import {
  IconBuildingStore,
  IconPlug,
  IconPlugConnected,
  IconTrash,
} from "@tabler/icons-react";

import { api } from "@whirl/backend/convex/_generated/api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  canReconnect,
  errorText,
  needsSignIn,
  useConnectFlow,
  useInstalledIntegrations,
  type InstalledIntegration,
} from "@/lib/integrations-data";
import { showToast } from "@/lib/toasts";
import { useView } from "@/lib/view";
import { SettingsCard, SettingsGroupHeader } from "../settings-rows";
import {
  InstalledRow,
  InstalledRowsList,
  RowSkeletons,
  integrationStatus,
} from "./installed-row";

/* Integrations installed from the store, managed where the rest of the
   user's kit lives. Official listings never show up as MCP servers — that
   list (servers-card.tsx) is strictly bring-your-own. */

export function ConnectedIntegrationsCard() {
  const { openIntegrations } = useView();
  const installed = useInstalledIntegrations();

  const setServerEnabled = useMutation(api.mcpServers.setServerEnabled);
  const removeServer = useMutation(api.mcpServers.removeServer);
  const connect = useConnectFlow();

  // The row pending its "are you sure?" — one dialog serves the whole card.
  const [confirming, setConfirming] = useState<InstalledIntegration | null>(
    null,
  );

  const toggle = (item: InstalledIntegration, enabled: boolean) => {
    setServerEnabled({ id: item.serverId, enabled }).catch((error: unknown) =>
      showToast(
        errorText(error, "Couldn't update that integration. Try again."),
      ),
    );
  };

  const uninstall = (item: InstalledIntegration) => {
    removeServer({ id: item.serverId })
      .then(() => showToast(`${item.name} uninstalled.`))
      .catch((error: unknown) =>
        showToast(errorText(error, "Couldn't uninstall that. Try again.")),
      );
  };

  const startConnect = (item: InstalledIntegration) => {
    connect(item).catch((error: unknown) =>
      showToast(errorText(error, "Couldn't start the sign-in. Try again.")),
    );
  };

  return (
    <>
      <section>
        <SettingsGroupHeader
          title="Connected integrations"
          description="Installed from the store — their tools join every chat."
          control={
            <Button variant="secondary" size="sm" onClick={openIntegrations}>
              <IconBuildingStore size={14} stroke={2} />
              Browse store
            </Button>
          }
        />
        <SettingsCard>
          {installed === null ? (
            <RowSkeletons rows={2} />
          ) : installed.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Nothing installed yet — the store has plenty to plug in.
            </p>
          ) : (
            <InstalledRowsList>
              {installed.map((item) => (
                <InstalledRow
                  key={item.serverId}
                  name={item.name}
                  verified={item.verified}
                  logoUrl={item.logoUrl}
                  iconSvg={item.iconSvg}
                  status={integrationStatus(item)}
                  enabled={item.enabled}
                  onToggle={(enabled) => toggle(item, enabled)}
                  action={
                    <>
                      {/* An expired sign-in is the row's most urgent state, so
                          its button leads rather than blending in — same slot,
                          primary weight, and it says reconnect because that's
                          what happens. */}
                      {item.needsReauth && canReconnect(item) ? (
                        <Button
                          size="sm"
                          className="mr-1"
                          onClick={() => startConnect(item)}
                        >
                          <IconPlugConnected size={13} stroke={2} />
                          Reconnect
                        </Button>
                      ) : (
                        needsSignIn(item) && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="mr-1"
                            onClick={() => startConnect(item)}
                          >
                            <IconPlug size={13} stroke={2} />
                            Connect
                          </Button>
                        )
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Uninstall ${item.name}`}
                        onClick={() => setConfirming(item)}
                        className="text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
                      >
                        <IconTrash size={14} stroke={2} />
                      </Button>
                    </>
                  }
                />
              ))}
            </InstalledRowsList>
          )}
        </SettingsCard>
      </section>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={`Uninstall ${confirming?.name ?? "this integration"}?`}
        message="Whirl loses its tools, and any sign-in or keys go with it. You can always reinstall it from the store."
        confirmLabel="Uninstall"
        destructive
        onConfirm={() => {
          if (confirming) uninstall(confirming);
          setConfirming(null);
        }}
      />
    </>
  );
}
