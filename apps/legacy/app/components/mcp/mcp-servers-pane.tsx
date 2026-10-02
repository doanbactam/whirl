import { useEffect, useState } from "react";
import { useUser } from "@clerk/tanstack-react-start";
import { useCustomer } from "autumn-js/react";
import { IconPlus, IconServer2, IconSparkles } from "@tabler/icons-react";

import { Spinner } from "~/components/spinner";
import { useUpgrade } from "~/components/upgrade-modal";
import { McpServerForm } from "~/components/mcp/mcp-server-form";
import { McpServerRow } from "~/components/mcp/mcp-server-row";
import {
  openOAuthPopup,
  useMcpServers,
  type McpServer,
} from "~/data/mcpServers";
import { userErrorMessage } from "~/lib/errors";
import { readFreeMessages } from "~/lib/messages";
import { showToast } from "~/data/toasts";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

export function McpServersPane() {
  const { isSignedIn } = useUser();
  const { customer, isLoading } = useCustomer();
  const free = readFreeMessages(customer);

  // Signed in + no customer = still loading — don't flash the locked upsell.
  if (!customer && (isLoading || isSignedIn)) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner size={16} className="text-blue-500" />
      </div>
    );
  }

  if (free.isFree) return <McpLocked />;

  return <McpManager />;
}

function McpLocked() {
  const { open } = useUpgrade();
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-black/[0.06] bg-black/[0.015] px-6 py-10 text-center dark:border-white/[0.06] dark:bg-white/[0.02]">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/[0.05] text-neutral-700 dark:bg-white/[0.08] dark:text-neutral-200">
        <IconServer2 size={24} stroke={2} />
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          MCP servers are a paid perk
        </h3>
        <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          Plug in your own tools, Whirl can call them mid-chat: search your
          notes, file a ticket, hit your API. Upgrade and bring your own
          superpowers.
        </p>
      </div>
      <button
        type="button"
        onClick={() => open("mcp")}
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-[13px] font-medium text-white transition hover:bg-blue-500"
      >
        <IconSparkles size={15} stroke={2} />
        See plans
      </button>
    </div>
  );
}

function McpManager() {
  const {
    servers,
    addServer,
    updateServer,
    setServerEnabled,
    removeServer,
    testConnection,
    startOAuth,
    disconnectOAuth,
  } = useMcpServers(true);
  const capture = useCapture();
  // null = no editor; "new" = add form; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);

  const editingServer: McpServer | undefined =
    editing && editing !== "new"
      ? servers?.find((s) => s.id === editing)
      : undefined;

  // The OAuth callback popup posts back here when the user finishes (or fails)
  // the consent flow; `listServers` already updates the row reactively, so we
  // just surface a toast + analytics.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; ok?: boolean; error?: string }
        | undefined;
      if (data?.type !== "mcp-oauth") return;
      if (data.ok) {
        showToast({ message: "Connected." });
        capture(ANALYTICS_EVENTS.mcpOAuthConnected);
      } else {
        showToast({
          message: data.error || "Couldn't connect. Try again.",
          tone: "danger",
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [capture]);

  const toggle = async (server: McpServer, enabled: boolean) => {
    try {
      await setServerEnabled({ id: server.id, enabled });
      capture(ANALYTICS_EVENTS.mcpServerToggled, { enabled });
    } catch {
      showToast({
        message: "Couldn't update that server. Try again.",
        tone: "danger",
      });
    }
  };

  const remove = async (server: McpServer) => {
    try {
      await removeServer({ id: server.id });
      capture(ANALYTICS_EVENTS.mcpServerRemoved);
    } catch {
      showToast({
        message: "Couldn't delete that server. Try again.",
        tone: "danger",
      });
    }
  };

  const connect = async (serverId: string) => {
    capture(ANALYTICS_EVENTS.mcpOAuthStarted);
    try {
      await openOAuthPopup(startOAuth, serverId);
    } catch (error) {
      showToast({
        tone: "danger",
        message: userErrorMessage(error, "Couldn't start sign-in. Try again."),
      });
    }
  };

  const disconnect = async (server: McpServer) => {
    try {
      await disconnectOAuth({ id: server.id });
      capture(ANALYTICS_EVENTS.mcpOAuthDisconnected);
    } catch {
      showToast({ message: "Couldn't disconnect. Try again.", tone: "danger" });
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-black/[0.04] py-3.5 dark:border-white/[0.05]">
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
            <IconServer2 size={14} stroke={2} />
            MCP servers
          </span>
          <span className="mt-0.5 text-[12px] text-neutral-500 dark:text-neutral-400">
            Connect remote (HTTP) MCP servers to give Whirl your own tools. Each
            server's tools become available to the model in every chat.
          </span>
        </div>
        {editing !== "new" && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
          >
            <IconPlus size={15} stroke={2} />
            Add server
          </button>
        )}
      </div>

      {editing === "new" && (
        <div className="mt-4">
          <McpServerForm
            onSave={async (args) => {
              await addServer(args);
              capture(ANALYTICS_EVENTS.mcpServerAdded, {
                header_count: args.headers.length,
              });
            }}
            onTest={(args) => testConnection(args)}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      <div className="mt-4">
        <McpList
          servers={servers}
          editingId={editingServer?.id ?? null}
          onToggle={toggle}
          onEdit={(s) => setEditing(s.id)}
          onDelete={remove}
          onConnect={(s) => void connect(s.id)}
          renderEditor={(s) => (
            <McpServerForm
              server={s}
              onSave={async (args) => {
                await updateServer({
                  id: s.id,
                  name: args.name,
                  url: args.url,
                  headers: args.headers,
                });
                capture(ANALYTICS_EVENTS.mcpServerUpdated);
              }}
              onTest={(args) => testConnection({ id: s.id, ...args })}
              onConnect={() => connect(s.id)}
              onDisconnect={() => disconnect(s)}
              onCancel={() => setEditing(null)}
            />
          )}
        />
      </div>
    </div>
  );
}

function McpList({
  servers,
  editingId,
  onToggle,
  onEdit,
  onDelete,
  onConnect,
  renderEditor,
}: {
  servers: McpServer[] | undefined;
  editingId: string | null;
  onToggle: (server: McpServer, enabled: boolean) => void;
  onEdit: (server: McpServer) => void;
  onDelete: (server: McpServer) => void;
  onConnect: (server: McpServer) => void;
  renderEditor: (server: McpServer) => React.ReactNode;
}) {
  if (servers === undefined) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl border border-black/[0.06] dark:border-white/[0.06]">
        <Spinner size={16} className="text-blue-500" />
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-black/[0.1] px-6 text-center text-[12.5px] text-neutral-500 dark:border-white/[0.1] dark:text-neutral-400">
        No servers yet. Add one to give Whirl your own tools.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-black/[0.06] dark:border-white/[0.06]">
      <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
        {servers.map((server) =>
          editingId === server.id ? (
            <li key={server.id} className="p-3">
              {renderEditor(server)}
            </li>
          ) : (
            <McpServerRow
              key={server.id}
              server={server}
              onToggle={(enabled) => void onToggle(server, enabled)}
              onEdit={() => onEdit(server)}
              onDelete={() => void onDelete(server)}
              onConnect={() => onConnect(server)}
            />
          ),
        )}
      </ul>
    </div>
  );
}
