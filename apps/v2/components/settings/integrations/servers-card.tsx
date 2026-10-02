"use client";

import { useState } from "react";
import {
  IconAlertTriangle,
  IconAlertTriangleFilled,
  IconCheck,
  IconPencil,
  IconPlug,
  IconPlugConnected,
  IconPlus,
  IconServer2,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/toggle-switch";
import { errorText, openAuthPopup } from "@/lib/integrations-data";
import { useMcpServers, type McpServer } from "@/lib/mcp-servers";
import { formatRelative } from "@/lib/relative-time";
import { showToast } from "@/lib/toasts";
import { ArmRemoveButton } from "../arm-remove-button";
import {
  SettingsCard,
  SettingsGroupHeader,
  SettingsRow,
} from "../settings-rows";
import { RowSkeletons } from "./installed-row";
import { McpServerForm } from "./mcp-server-form";

/* Bring-your-own MCP servers. Strictly the hand-added kind — store installs
   are integrations and live in connected-integrations-card.tsx, though both
   share the same slot pool (the meter below counts them together). Add and
   edit unfold in place, no dialogs. */

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function statusLine(server: McpServer): React.ReactNode {
  const host = (
    <span className="text-muted-foreground/70">{hostOf(server.url)}</span>
  );
  // Same order as the integration rows: expired outranks whatever error text
  // came back with it, because only one of the two says what to do.
  if (server.needsReauth) {
    return (
      <>
        {host} ·{" "}
        <span className="text-destructive">
          <IconAlertTriangleFilled size={11} className="mr-0.5 -mt-px inline" />
          {server.authMode === "oauth"
            ? "Sign-in expired — reconnect"
            : "Credentials stopped working"}
        </span>
      </>
    );
  }
  if (server.lastError) {
    return (
      <>
        {host} · <span className="text-destructive">{server.lastError}</span>
      </>
    );
  }
  if (server.authMode === "oauth" && !server.oauthConnected) {
    return (
      <>
        {host} ·{" "}
        <span className="text-amber-600 dark:text-amber-400">
          <IconAlertTriangle size={11} className="mr-0.5 -mt-px inline" />
          Not connected yet
        </span>
      </>
    );
  }
  if (server.lastConnectedAt) {
    return (
      <>
        {host} ·{" "}
        <span className="text-emerald-600 dark:text-emerald-400">
          <IconCheck size={11} className="mr-0.5 -mt-px inline" />
          Connected {formatRelative(server.lastConnectedAt)}
        </span>
      </>
    );
  }
  return <>{host} · Not tested yet</>;
}

export function ServersCard() {
  const {
    servers,
    addServer,
    updateServer,
    setServerEnabled,
    removeServer,
    testConnection,
    startOAuth,
    disconnectOAuth,
  } = useMcpServers();

  // null = no editor; "new" = add form; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);

  // Store installs are integrations, not servers — they show one card up.
  const ownServers = servers?.filter((server) => !server.fromStore);

  const connect = (server: McpServer) => {
    openAuthPopup(
      async () => (await startOAuth({ id: server.id })).authorizationUrl,
    ).catch((error: unknown) =>
      showToast(errorText(error, "Couldn't start the sign-in. Try again.")),
    );
  };

  return (
    <section>
      <SettingsGroupHeader
        title="Custom MCP servers"
        description="Point Whirl at any remote (HTTP) MCP server — its tools join every chat."
        control={
          editing === "new" ? undefined : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditing("new")}
            >
              <IconPlus size={14} stroke={2} />
              Add server
            </Button>
          )
        }
      />
      <SettingsCard>
        {editing === "new" && (
          <div className="p-4">
            <McpServerForm
              onSave={async (args) => {
                await addServer(args);
              }}
              onTest={(args) => testConnection(args)}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}
        {ownServers === undefined ? (
          <RowSkeletons rows={2} />
        ) : ownServers.length === 0 ? (
          editing !== "new" && (
            <p className="p-4 text-sm text-muted-foreground">
              No servers yet — add one to give Whirl your own tools.
            </p>
          )
        ) : (
          ownServers.map((server) => {
            const isOAuth = server.authMode === "oauth";
            const needsConnect = isOAuth && !server.oauthConnected;
            const needsReconnect = isOAuth && server.needsReauth;
            const open = editing === server.id;
            return (
              <SettingsRow
                key={server.id}
                icon={IconServer2}
                title={server.name}
                description={statusLine(server)}
                control={
                  open ? undefined : (
                    <div className="flex items-center gap-1">
                      {needsReconnect ? (
                        <Button
                          size="sm"
                          className="mr-1"
                          onClick={() => connect(server)}
                        >
                          <IconPlugConnected size={13} stroke={2} />
                          Reconnect
                        </Button>
                      ) : (
                        needsConnect && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="mr-1"
                            onClick={() => connect(server)}
                          >
                            <IconPlug size={13} stroke={2} />
                            Connect
                          </Button>
                        )
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${server.name}`}
                        className="text-muted-foreground"
                        onClick={() => setEditing(server.id)}
                      >
                        <IconPencil size={15} stroke={2} />
                      </Button>
                      <ArmRemoveButton
                        label={server.name}
                        onRemove={() => {
                          removeServer({ id: server.id }).catch(
                            (error: unknown) =>
                              showToast(
                                errorText(
                                  error,
                                  "Couldn't delete that server. Try again.",
                                ),
                              ),
                          );
                        }}
                      />
                      <span className="ml-1">
                        <ToggleSwitch
                          checked={server.enabled}
                          onCheckedChange={(enabled) => {
                            setServerEnabled({
                              id: server.id,
                              enabled,
                            }).catch((error: unknown) =>
                              showToast(
                                errorText(
                                  error,
                                  "That didn't stick — try again.",
                                ),
                              ),
                            );
                          }}
                          aria-label={`${server.enabled ? "Pause" : "Resume"} ${server.name}`}
                        />
                      </span>
                    </div>
                  )
                }
              >
                {open && (
                  <McpServerForm
                    server={server}
                    onSave={async (args) => {
                      await updateServer({
                        id: server.id,
                        name: args.name,
                        url: args.url,
                        headers: args.headers,
                      });
                    }}
                    onTest={(args) =>
                      testConnection({ id: server.id, ...args })
                    }
                    onConnect={() => connect(server)}
                    onDisconnect={() => {
                      disconnectOAuth({ id: server.id }).catch(
                        (error: unknown) =>
                          showToast(
                            errorText(error, "Couldn't disconnect. Try again."),
                          ),
                      );
                    }}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </SettingsRow>
            );
          })
        )}
      </SettingsCard>
    </section>
  );
}
