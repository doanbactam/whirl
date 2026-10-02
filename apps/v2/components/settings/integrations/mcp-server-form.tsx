"use client";

import { useState } from "react";
import { IconCheck, IconPlug, IconPlus, IconTrash } from "@tabler/icons-react";

import { ChoiceCapsules } from "@/components/settings/choice-capsules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorText } from "@/lib/integrations-data";
import type {
  McpAuthMode,
  McpHeaderInput,
  McpServer,
  TestConnectionResult,
} from "@/lib/mcp-servers";
import { showToast } from "@/lib/toasts";
import { Spinner } from "@/components/ui/spinner";

type HeaderRow = { key: string; value: string; hasValue: boolean };

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

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
  const isEdit = Boolean(server);
  const [authMode, setAuthMode] = useState<McpAuthMode>(
    server?.authMode ?? "headers",
  );
  const [name, setName] = useState(server?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [headers, setHeaders] = useState<HeaderRow[]>(
    server?.headers.map((h) => ({
      key: h.key,
      value: "",
      hasValue: h.hasValue,
    })) ?? [],
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
          .map((h) =>
            h.value ? { key: h.key, value: h.value } : { key: h.key },
          );

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
    } catch (error) {
      setTestResult({
        ok: false,
        toolCount: 0,
        tools: [],
        error: errorText(error, "Connection failed."),
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
      showToast(errorText(error, "Couldn't save that server. Try again."));
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <FieldLabel>Name</FieldLabel>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Linear"
          maxLength={60}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <FieldLabel>Server URL</FieldLabel>
        <Input
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setTestResult(null);
          }}
          placeholder="https://mcp.example.com/sse"
          spellCheck={false}
          autoCapitalize="none"
        />
        <p className="text-[11.5px] text-muted-foreground/70">
          Remote (HTTP) MCP servers only. Local stdio servers aren't supported.
        </p>
      </label>

      <div className="flex flex-col gap-1.5">
        <FieldLabel>Authentication</FieldLabel>
        {isEdit ? (
          <span className="text-[12.5px] text-muted-foreground">
            {isOAuth ? "OAuth (sign-in)" : "Custom headers"}
          </span>
        ) : (
          <div className="max-w-56">
            <ChoiceCapsules
              value={authMode}
              onChange={(mode) => {
                setAuthMode(mode);
                setTestResult(null);
              }}
              options={[
                { value: "headers", label: "Headers" },
                { value: "oauth", label: "OAuth" },
              ]}
              aria-label="Authentication mode"
            />
          </div>
        )}
      </div>

      {isOAuth ? (
        <p className="rounded-lg bg-black/[0.025] px-3 py-2 text-xs leading-relaxed text-muted-foreground dark:bg-white/[0.04]">
          {isEdit
            ? "Whirl registers itself with the server and you approve access in a popup. No tokens to copy."
            : "Save the server, then click Connect to sign in through your browser. Whirl registers itself automatically, no tokens to copy."}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <FieldLabel>Headers</FieldLabel>
            {headers.length < 10 && (
              <Button variant="ghost" size="xs" onClick={addHeader}>
                <IconPlus size={13} stroke={2} />
                Add header
              </Button>
            )}
          </div>
          {headers.length === 0 ? (
            <p className="text-[11.5px] text-muted-foreground/70">
              Optional. Add an Authorization header to authenticate (e.g.
              <span className="font-medium"> Authorization: Bearer …</span>).
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {headers.map((header, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={header.key}
                    onChange={(event) =>
                      setHeader(idx, { key: event.target.value })
                    }
                    placeholder="Authorization"
                    spellCheck={false}
                    autoCapitalize="none"
                    className="flex-1"
                  />
                  <Input
                    type="password"
                    value={header.value}
                    onChange={(event) =>
                      setHeader(idx, { value: event.target.value })
                    }
                    placeholder={
                      header.hasValue ? "•••••• (unchanged)" : "Bearer …"
                    }
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="off"
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove header"
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => removeHeader(idx)}
                  >
                    <IconTrash size={15} stroke={2} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {testResult && (
        <div
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] ${
            testResult.ok
              ? "bg-emerald-500/[0.08] text-emerald-700 dark:bg-emerald-400/[0.1] dark:text-emerald-300"
              : "bg-destructive/[0.08] text-destructive"
          }`}
        >
          {testResult.ok ? (
            <>
              <IconCheck size={15} stroke={2.25} className="mt-px shrink-0" />
              {/* Tool names and server errors are both arbitrary strings —
                  they wrap inside the banner rather than widening it. */}
              <span className="min-w-0 break-words">
                Connected · {testResult.toolCount}{" "}
                {testResult.toolCount === 1 ? "tool" : "tools"}
                {testResult.tools.length > 0 && (
                  <span className="opacity-70">
                    {" "}
                    (
                    {testResult.tools
                      .slice(0, 6)
                      .map((tool) => tool.name)
                      .join(", ")}
                    {testResult.tools.length > 6 ? ", …" : ""})
                  </span>
                )}
              </span>
            </>
          ) : (
            <span className="min-w-0 break-words">
              {testResult.error ?? "Couldn't connect."}
            </span>
          )}
        </div>
      )}

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isOAuth && isEdit && !connected && onConnect && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void onConnect()}
            >
              <IconPlug size={14} stroke={2} />
              Connect
            </Button>
          )}
          {(!isOAuth || (isEdit && connected)) && (
            <Button
              variant="secondary"
              size="sm"
              disabled={!canSubmit || testing}
              className="min-w-[128px]"
              onClick={() => void handleTest()}
            >
              {testing ? (
                <Spinner />
              ) : (
                <>
                  <IconPlug size={14} stroke={2} />
                  Test connection
                </>
              )}
            </Button>
          )}
          {isOAuth && isEdit && connected && onDisconnect && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void onDisconnect()}
            >
              Disconnect
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit || saving}
            className="min-w-[84px]"
            onClick={() => void handleSave()}
          >
            {saving ? <Spinner /> : server ? "Save" : "Add server"}
          </Button>
        </div>
      </div>
    </div>
  );
}
