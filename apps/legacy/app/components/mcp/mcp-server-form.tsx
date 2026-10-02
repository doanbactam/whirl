import { useState } from "react";
import { IconCheck, IconPlug, IconPlus, IconTrash } from "@tabler/icons-react";

import { Spinner } from "~/components/spinner";
import { showToast } from "~/data/toasts";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";
import type {
  McpAuthMode,
  McpHeaderInput,
  McpServer,
  TestConnectionResult,
} from "~/data/mcpServers";

const INPUT_CLASS =
  "h-9 w-full rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:bg-black/[0.02] focus-visible:border-black/20 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:hover:bg-white/[0.04] dark:focus-visible:border-white/30";

type HeaderRow = { key: string; value: string; hasValue: boolean };

const AUTH_OPTIONS: { value: McpAuthMode; label: string }[] = [
  { value: "headers", label: "Headers" },
  { value: "oauth", label: "OAuth" },
];

/** Add or edit one MCP server. `server` undefined => add mode. */
export function McpServerForm({
  server,
  onSave,
  onTest,
  onConnect,
  onDisconnect,
  onCancel,
}: {
  server?: McpServer;
  onSave: (args: {
    name: string;
    url: string;
    authMode: McpAuthMode;
    headers: McpHeaderInput[];
  }) => Promise<void>;
  onTest: (args: {
    url: string;
    headers: McpHeaderInput[];
  }) => Promise<TestConnectionResult>;
  onConnect?: () => Promise<void> | void;
  onDisconnect?: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const capture = useCapture();
  const isEdit = Boolean(server);
  const [authMode, setAuthMode] = useState<McpAuthMode>(
    server?.authMode ?? "headers",
  );
  const [name, setName] = useState(server?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [headers, setHeaders] = useState<HeaderRow[]>(
    server?.headers.map((h) => ({ key: h.key, value: "", hasValue: h.hasValue })) ??
      [],
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(
    null,
  );

  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  const canSubmit = trimmedName.length > 0 && /^https?:\/\//i.test(trimmedUrl);
  const isOAuth = authMode === "oauth";
  const connected = server?.oauthConnected === true;

  const buildHeaderInputs = (): McpHeaderInput[] =>
    isOAuth
      ? []
      : headers
          .map((h) => ({ key: h.key.trim(), value: h.value }))
          .filter((h) => h.key.length > 0)
          .map((h) => (h.value ? { key: h.key, value: h.value } : { key: h.key }));

  const setHeader = (idx: number, patch: Partial<HeaderRow>) => {
    setHeaders((rows) =>
      rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    );
    setTestResult(null);
  };

  const addHeader = () =>
    setHeaders((rows) => [...rows, { key: "", value: "", hasValue: false }]);

  const removeHeader = (idx: number) => {
    setHeaders((rows) => rows.filter((_, i) => i !== idx));
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!canSubmit || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTest({
        url: trimmedUrl,
        headers: buildHeaderInputs(),
      });
      setTestResult(result);
      capture(ANALYTICS_EVENTS.mcpServerTestRun, {
        ok: result.ok,
        tool_count: result.toolCount,
      });
    } catch (error) {
      setTestResult({
        ok: false,
        toolCount: 0,
        tools: [],
        error: error instanceof Error ? error.message : "Connection failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      await onSave({
        name: trimmedName,
        url: trimmedUrl,
        authMode,
        headers: buildHeaderInputs(),
      });
      onCancel();
    } catch (error) {
      showToast({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Couldn't save that server. Try again.",
      });
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-black/[0.08] bg-black/[0.015] p-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div className="flex flex-col gap-1.5">
        <label className="text-[12px] font-medium text-neutral-600 dark:text-neutral-300">
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Linear"
          maxLength={60}
          className={INPUT_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[12px] font-medium text-neutral-600 dark:text-neutral-300">
          Server URL
        </label>
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setTestResult(null);
          }}
          placeholder="https://mcp.example.com/sse"
          spellCheck={false}
          autoCapitalize="none"
          className={INPUT_CLASS}
        />
        <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
          Remote (HTTP) MCP servers only. Local stdio servers aren't supported.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[12px] font-medium text-neutral-600 dark:text-neutral-300">
          Authentication
        </label>
        {isEdit ? (
          <span className="text-[12.5px] text-neutral-600 dark:text-neutral-300">
            {isOAuth ? "OAuth (sign-in)" : "Custom headers"}
          </span>
        ) : (
          <div className="inline-flex w-fit rounded-lg border border-black/[0.08] bg-white p-0.5 dark:border-white/[0.1] dark:bg-[#222]">
            {AUTH_OPTIONS.map((opt) => {
              const active = opt.value === authMode;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setAuthMode(opt.value);
                    setTestResult(null);
                  }}
                  className={`rounded-md px-3 py-1 text-[12.5px] font-medium transition ${
                    active
                      ? "bg-black/[0.06] text-neutral-900 dark:bg-white/[0.1] dark:text-neutral-100"
                      : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {isOAuth ? (
        <p className="rounded-lg border border-black/[0.06] bg-black/[0.015] px-3 py-2 text-[12px] leading-relaxed text-neutral-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-neutral-400">
          {isEdit
            ? "Whirl registers itself with the server and you approve access in a popup. No tokens to copy."
            : "Save the server, then click Connect to sign in through your browser. Whirl registers itself automatically, no tokens to copy."}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[12px] font-medium text-neutral-600 dark:text-neutral-300">
              Headers
            </label>
            {headers.length < 10 && (
              <button
                type="button"
                onClick={addHeader}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-neutral-500 transition hover:bg-black/[0.04] hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-neutral-200"
              >
                <IconPlus size={13} stroke={2} />
                Add header
              </button>
            )}
          </div>
          {headers.length === 0 ? (
            <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
              Optional. Add an Authorization header to authenticate (e.g.
              <span className="font-medium"> Authorization: Bearer …</span>).
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {headers.map((header, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    value={header.key}
                    onChange={(e) => setHeader(idx, { key: e.target.value })}
                    placeholder="Authorization"
                    spellCheck={false}
                    autoCapitalize="none"
                    className={`${INPUT_CLASS} flex-1`}
                  />
                  <input
                    type="password"
                    value={header.value}
                    onChange={(e) => setHeader(idx, { value: e.target.value })}
                    placeholder={
                      header.hasValue ? "•••••• (unchanged)" : "Bearer …"
                    }
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="off"
                    className={`${INPUT_CLASS} flex-1`}
                  />
                  <button
                    type="button"
                    aria-label="Remove header"
                    onClick={() => removeHeader(idx)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-red-500/[0.08] hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-400/[0.1] dark:hover:text-red-300"
                  >
                    <IconTrash size={15} stroke={2} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {testResult && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px] ${
            testResult.ok
              ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/[0.08] dark:text-emerald-300"
              : "border-red-500/20 bg-red-500/[0.06] text-red-600 dark:border-red-400/20 dark:bg-red-400/[0.08] dark:text-red-300"
          }`}
        >
          {testResult.ok ? (
            <>
              <IconCheck size={15} stroke={2.25} className="mt-px shrink-0" />
              <span>
                Connected · {testResult.toolCount}{" "}
                {testResult.toolCount === 1 ? "tool" : "tools"}
                {testResult.tools.length > 0 && (
                  <span className="text-emerald-600/80 dark:text-emerald-300/80">
                    {" "}
                    ({testResult.tools
                      .slice(0, 6)
                      .map((t) => t.name)
                      .join(", ")}
                    {testResult.tools.length > 6 ? ", …" : ""})
                  </span>
                )}
              </span>
            </>
          ) : (
            <span>{testResult.error ?? "Couldn't connect."}</span>
          )}
        </div>
      )}

      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isOAuth && isEdit && !connected && onConnect && (
            <button
              type="button"
              onClick={() => void onConnect()}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-[13px] font-medium text-white transition hover:bg-blue-500"
            >
              <IconPlug size={15} stroke={2} />
              Connect
            </button>
          )}
          {isOAuth && isEdit && connected && (
            <>
              <button
                type="button"
                disabled={!canSubmit || testing}
                onClick={() => void handleTest()}
                className="inline-flex h-9 min-w-[136px] items-center justify-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 disabled:opacity-50 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
              >
                {testing ? (
                  <Spinner size={14} className="text-blue-500" />
                ) : (
                  <>
                    <IconPlug size={15} stroke={2} />
                    Test connection
                  </>
                )}
              </button>
              {onDisconnect && (
                <button
                  type="button"
                  onClick={() => void onDisconnect()}
                  className="inline-flex h-9 items-center rounded-lg border border-red-500/30 px-3 text-[13px] font-medium text-red-600 transition hover:bg-red-500/[0.06] dark:border-red-400/30 dark:text-red-300 dark:hover:bg-red-400/[0.08]"
                >
                  Disconnect
                </button>
              )}
            </>
          )}
          {!isOAuth && (
            <button
              type="button"
              disabled={!canSubmit || testing}
              onClick={() => void handleTest()}
              className="inline-flex h-9 min-w-[136px] items-center justify-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 disabled:opacity-50 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
            >
              {testing ? (
                <Spinner size={14} className="text-blue-500" />
              ) : (
                <>
                  <IconPlug size={15} stroke={2} />
                  Test connection
                </>
              )}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-lg px-3 text-[13px] text-neutral-600 transition hover:bg-black/[0.04] dark:text-neutral-300 dark:hover:bg-white/[0.06]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit || saving}
            onClick={() => void handleSave()}
            className="inline-flex h-9 min-w-[88px] items-center justify-center rounded-lg bg-blue-600 px-3.5 text-[13px] font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? (
              <Spinner size={14} className="text-white" />
            ) : server ? (
              "Save"
            ) : (
              "Add server"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
