import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import {
  IconCheck,
  IconDownload,
  IconLockOpen2,
  IconPlus,
  IconRadar,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";

import { Spinner } from "~/components/spinner";
import { CONSOLE_EVENTS, useCapture } from "~/lib/analytics";
import { api, type AuthMode, type Id } from "~/lib/backend";
import { downloadTextFile } from "~/lib/download";
import { userErrorMessage } from "~/lib/errors";
import {
  inputClass,
  textareaClass,
} from "~/pages/integrations/auth-config-fields";
import {
  mergeToolsFromJsonc,
  toolsToJsonc,
} from "~/pages/integrations/tool-descriptions-file";

/** A tool in the form: the scanned name, the server's own blurb, and the
 * developer-written status phrases store users will actually read. */
export type ToolDraft = {
  name: string;
  /** What the server advertises — shown as a hint, never submitted. */
  serverDescription?: string;
  /** The running phrase, e.g. "Searching your issues". */
  description: string;
  /** The done phrase, e.g. "Searched your issues". */
  completed: string;
  /** True for rows added by hand (name editable). */
  manual?: boolean;
};

const linkButtonClass =
  "inline-flex w-fit items-center gap-1.5 text-[12px] font-medium text-[#0c82f2] transition-opacity hover:opacity-80";

const secondaryButtonClass =
  "inline-flex h-9 items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3.5 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 disabled:opacity-50 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]";

/**
 * Scans the MCP server's tools/list and lays out one required description
 * field per tool. API-key servers scan with the test values from the auth
 * section; OAuth servers get a "Connect & scan" popup that runs the real
 * sign-in (scan-scoped — the grant is never attached to the integration).
 * Rescanning keeps descriptions already written for tools that are still
 * there.
 */
export function ToolScanSection({
  url,
  authMode,
  scanHeaders,
  tools,
  onToolsChange,
}: {
  url: string;
  authMode: AuthMode;
  scanHeaders: { key: string; value: string }[];
  tools: ToolDraft[] | null;
  onToolsChange: (tools: ToolDraft[] | null) => void;
}) {
  const scanTools = useAction(api.integrations.scanTools);
  const startScanOAuth = useAction(api.integrationScan.startScanOAuth);
  const capture = useCapture();
  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flowId, setFlowId] = useState<Id<"integrationScanFlows"> | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoScannedRef = useRef(false);

  // The OAuth grant is bound to one server — a different URL needs a fresh
  // sign-in.
  useEffect(() => {
    setFlowId(null);
    autoScannedRef.current = false;
  }, [url, authMode]);

  const flow = useQuery(
    api.integrationScan.getScanFlow,
    flowId ? { id: flowId } : "skip",
  );
  const connected = flow?.status === "connected";
  const waitingForSignIn = flowId !== null && flow?.status === "pending";

  const scan = async (withFlowId: Id<"integrationScanFlows"> | null) => {
    setScanning(true);
    setError(null);
    setNotice(null);
    try {
      const result = await scanTools({
        url,
        headers: scanHeaders.length > 0 ? scanHeaders : undefined,
        scanFlowId: withFlowId ?? undefined,
      });
      if (!result.ok) {
        setError(result.error ?? "Couldn't reach the MCP server.");
        return;
      }
      capture(CONSOLE_EVENTS.integrationToolsScanned, {
        authMode,
        toolCount: result.tools.length,
      });
      if (result.tools.length === 0) {
        setError("Connected, but the server advertises no tools.");
        return;
      }
      // Keep phrases the developer already wrote for tools that are still
      // advertised; drop the rest.
      const existing = new Map((tools ?? []).map((t) => [t.name, t]));
      onToolsChange(
        result.tools.map((t) => ({
          name: t.name,
          serverDescription: t.description,
          description: existing.get(t.name)?.description ?? "",
          completed: existing.get(t.name)?.completed ?? "",
        })),
      );
    } catch (e) {
      setError(userErrorMessage(e, "Scan failed."));
    } finally {
      setScanning(false);
    }
  };

  // The popup finished signing in (the flow row flipped via the callback) —
  // kick off the scan without another click.
  useEffect(() => {
    if (connected && flowId && !autoScannedRef.current) {
      autoScannedRef.current = true;
      void scan(flowId);
    }
    if (flow?.status === "failed") {
      setError(flow.error ?? "Sign-in failed.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, flow?.status]);

  const connectAndScan = async () => {
    setStarting(true);
    setError(null);
    try {
      const { flowId: newFlowId, authorizationUrl } = await startScanOAuth({
        url,
      });
      const popup = window.open(
        authorizationUrl,
        "whirl-scan-oauth",
        "width=520,height=680",
      );
      if (!popup) {
        setError("Popup blocked — allow popups for the console and retry.");
        return;
      }
      autoScannedRef.current = false;
      setFlowId(newFlowId as Id<"integrationScanFlows">);
    } catch (e) {
      setError(userErrorMessage(e, "Couldn't start sign-in."));
    } finally {
      setStarting(false);
    }
  };

  const exportJsonc = () => {
    if (!tools) return;
    downloadTextFile(
      "whirl-tools.jsonc",
      toolsToJsonc(tools),
      "application/json",
    );
    capture(CONSOLE_EVENTS.integrationToolsExported, {
      toolCount: tools.length,
    });
  };

  const importJsonc = async (file: File) => {
    setError(null);
    setNotice(null);
    const result = mergeToolsFromJsonc(await file.text(), tools);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onToolsChange(result.tools);
    capture(CONSOLE_EVENTS.integrationToolsImported, {
      matched: result.matched,
      added: result.added,
    });
    const total = result.matched + result.added;
    setNotice(
      `Filled in ${total} tool${total === 1 ? "" : "s"} from the file` +
        (result.added > 0 ? ` — ${result.added} new.` : "."),
    );
  };

  const noUrl = url.trim().length === 0;
  const useOAuth = authMode === "oauth";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {useOAuth && !connected ? (
          <button
            type="button"
            disabled={starting || waitingForSignIn || noUrl}
            onClick={() => void connectAndScan()}
            className={secondaryButtonClass}
          >
            {starting || waitingForSignIn ? (
              <Spinner size={13} />
            ) : (
              <IconLockOpen2 size={15} stroke={2} />
            )}
            {waitingForSignIn ? "Waiting for sign-in…" : "Connect & scan"}
          </button>
        ) : (
          <button
            type="button"
            disabled={scanning || noUrl}
            onClick={() => void scan(useOAuth ? flowId : null)}
            className={secondaryButtonClass}
          >
            {scanning ? (
              <Spinner size={13} />
            ) : (
              <IconRadar size={15} stroke={2} />
            )}
            {tools === null ? "Scan tools" : "Rescan"}
          </button>
        )}
        {useOAuth && connected && (
          <span className="rounded-full bg-emerald-500/[0.1] px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/[0.15] dark:text-emerald-300">
            Signed in
          </span>
        )}
        {noUrl ? (
          <span className="text-[12px] text-neutral-400 dark:text-neutral-500">
            Enter the MCP server URL first.
          </span>
        ) : (
          useOAuth &&
          !connected && (
            <span className="text-[12px] text-neutral-400 dark:text-neutral-500">
              Signs into the server to read its tools — used for this scan
              only, never stored on the integration.
            </span>
          )
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-red-500/[0.08] px-3 py-2 text-[12.5px] text-red-700 dark:bg-red-500/[0.12] dark:text-red-300">
          {error}
        </p>
      )}

      {notice && (
        <p className="rounded-lg bg-emerald-500/[0.08] px-3 py-2 text-[12.5px] text-emerald-700 dark:bg-emerald-500/[0.12] dark:text-emerald-300">
          {notice}
        </p>
      )}

      {tools !== null && (
        <ul className="flex flex-col gap-3">
          {tools.map((tool, i) => (
            <li
              key={i}
              className="flex flex-col gap-2 rounded-xl border border-black/[0.06] p-3.5 dark:border-white/[0.08]"
            >
              <div className="flex items-center gap-2">
                {tool.manual ? (
                  <input
                    value={tool.name}
                    onChange={(e) =>
                      onToolsChange(
                        tools.map((t, j) =>
                          j === i ? { ...t, name: e.target.value } : t,
                        ),
                      )
                    }
                    placeholder="tool_name"
                    className={`${inputClass} max-w-60 font-mono text-[12px]`}
                  />
                ) : (
                  <code className="rounded-md bg-black/[0.04] px-1.5 py-0.5 font-mono text-[12px] text-neutral-800 dark:bg-white/[0.06] dark:text-neutral-200">
                    {tool.name}
                  </code>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${tool.name || "tool"}`}
                  onClick={() =>
                    onToolsChange(tools.filter((_, j) => j !== i))
                  }
                  className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-black/[0.05] hover:text-red-600 dark:hover:bg-white/[0.07] dark:hover:text-red-400"
                >
                  <IconTrash size={13} stroke={2} />
                </button>
              </div>
              {tool.serverDescription && (
                <p className="text-[11.5px] leading-snug text-neutral-400 italic dark:text-neutral-500">
                  Server says: {tool.serverDescription}
                </p>
              )}
              <textarea
                value={tool.description}
                onChange={(e) =>
                  onToolsChange(
                    tools.map((t, j) =>
                      j === i ? { ...t, description: e.target.value } : t,
                    ),
                  )
                }
                placeholder={'While it runs, e.g. "Searching your issues"'}
                maxLength={500}
                rows={2}
                className={textareaClass}
              />
              <textarea
                value={tool.completed}
                onChange={(e) =>
                  onToolsChange(
                    tools.map((t, j) =>
                      j === i ? { ...t, completed: e.target.value } : t,
                    ),
                  )
                }
                placeholder={'Once it’s done, e.g. "Searched your issues"'}
                maxLength={500}
                rows={2}
                className={textareaClass}
              />
              {(tool.description.trim() || tool.completed.trim()) && (
                <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-neutral-400 dark:text-neutral-500">
                  In chat:
                  {tool.description.trim() && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-2 py-0.5 text-neutral-500 dark:bg-white/[0.06] dark:text-neutral-400">
                      <Spinner size={9} />
                      {tool.description.trim()}
                    </span>
                  )}
                  {tool.description.trim() && tool.completed.trim() && (
                    <span aria-hidden>→</span>
                  )}
                  {tool.completed.trim() && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-2 py-0.5 text-neutral-500 dark:bg-white/[0.06] dark:text-neutral-400">
                      <IconCheck size={9} stroke={3} />
                      {tool.completed.trim()}
                    </span>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {tools !== null && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <button
            type="button"
            onClick={() =>
              onToolsChange([
                ...tools,
                { name: "", description: "", completed: "", manual: true },
              ])
            }
            className={linkButtonClass}
          >
            <IconPlus size={13} stroke={2.5} />
            Add a tool manually
          </button>
          <button
            type="button"
            onClick={exportJsonc}
            className={linkButtonClass}
            title="Download a commented JSONC template with every tool, fill it out, then upload it back"
          >
            <IconDownload size={13} stroke={2.5} />
            Download JSONC
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={linkButtonClass}
            title="Upload a filled-out file to fill in the phrases below — plain JSON or JSONC, comments and trailing commas welcome"
          >
            <IconUpload size={13} stroke={2.5} />
            Upload JSON / JSONC
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.jsonc,application/json,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importJsonc(file);
            }}
          />
        </div>
      )}
    </div>
  );
}
