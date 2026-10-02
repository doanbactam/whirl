import { useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconPencil,
  IconPlug,
  IconTrash,
} from "@tabler/icons-react";

import { Switch } from "~/components/memory-settings";
import type { McpServer } from "~/data/mcpServers";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatRelative(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** One MCP server: name, host, enable toggle, status, and edit/delete actions. */
export function McpServerRow({
  server,
  onToggle,
  onEdit,
  onDelete,
  onConnect,
}: {
  server: McpServer;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onConnect: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const needsConnect = server.authMode === "oauth" && !server.oauthConnected;

  const status = server.lastError
    ? {
        icon: IconAlertTriangle,
        text: server.lastError,
        className: "text-red-600 dark:text-red-300",
      }
    : needsConnect
      ? {
          icon: IconAlertTriangle,
          text: "Not connected",
          className: "text-amber-600 dark:text-amber-400",
        }
      : server.authMode === "oauth" && server.oauthConnected
        ? {
            icon: IconCheck,
            text: server.lastConnectedAt
              ? `Connected ${formatRelative(server.lastConnectedAt)}`
              : "Connected",
            className: "text-emerald-600 dark:text-emerald-400",
          }
        : server.lastConnectedAt
          ? {
              icon: IconCheck,
              text: `Connected ${formatRelative(server.lastConnectedAt)}`,
              className: "text-emerald-600 dark:text-emerald-400",
            }
          : null;

  return (
    <li className="group/mcp flex items-center gap-3 px-3 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
            {server.name}
          </span>
          <span className="truncate text-[12px] text-neutral-400 dark:text-neutral-500">
            {hostOf(server.url)}
          </span>
        </div>
        {status ? (
          <span
            className={`flex items-center gap-1 text-[11.5px] ${status.className}`}
          >
            <status.icon size={12} stroke={2} />
            <span className="truncate">{status.text}</span>
          </span>
        ) : (
          <span className="text-[11.5px] text-neutral-400 dark:text-neutral-500">
            Not tested yet
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {confirmingDelete ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-md px-2 py-1 text-[11.5px] text-neutral-500 transition hover:bg-black/[0.04] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={() => {
                onDelete();
                setConfirmingDelete(false);
              }}
              className="rounded-md px-2 py-1 text-[11.5px] font-medium text-red-600 transition hover:bg-red-500/[0.08] dark:text-red-300 dark:hover:bg-red-400/[0.1]"
            >
              Delete
            </button>
          </div>
        ) : (
          <>
            {needsConnect && (
              <button
                type="button"
                onClick={onConnect}
                className="mr-1 inline-flex h-7 items-center gap-1.5 rounded-md bg-blue-500/10 px-2.5 text-[12px] font-medium text-blue-600 transition hover:bg-blue-500/15 dark:bg-blue-400/15 dark:text-blue-300 dark:hover:bg-blue-400/20"
              >
                <IconPlug size={13} stroke={2} />
                Connect
              </button>
            )}
            <button
              type="button"
              aria-label="Edit server"
              onClick={onEdit}
              className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 opacity-0 transition hover:bg-black/[0.05] hover:text-neutral-800 focus-visible:opacity-100 group-hover/mcp:opacity-100 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-neutral-100"
            >
              <IconPencil size={14} stroke={2} />
            </button>
            <button
              type="button"
              aria-label="Delete server"
              onClick={() => setConfirmingDelete(true)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 opacity-0 transition hover:bg-red-500/[0.08] hover:text-red-600 focus-visible:opacity-100 group-hover/mcp:opacity-100 dark:text-neutral-400 dark:hover:bg-red-400/[0.1] dark:hover:text-red-300"
            >
              <IconTrash size={14} stroke={2} />
            </button>
            <span className="ml-1">
              <Switch checked={server.enabled} onChange={onToggle} />
            </span>
          </>
        )}
      </div>
    </li>
  );
}
