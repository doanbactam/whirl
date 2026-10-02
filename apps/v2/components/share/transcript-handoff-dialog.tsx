"use client";

import { useState } from "react";
import { IconCheck, IconCircleCheckFilled, IconCopy } from "@tabler/icons-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { threadShareUrl } from "@/lib/share";
import { AgentMark, type AgentMarkKey } from "./agent-marks";

/* The transcript hand-off modal: one command per coding agent that
   launches a fresh session, tells it it's resuming this conversation, and
   hands it the raw transcript link to fetch. The link itself rides at the
   bottom for everything else. */

const COPY_FLASH_MS = 1600;

const AGENTS: Array<{
  key: AgentMarkKey;
  name: string;
  command: (prompt: string) => string;
}> = [
  { key: "claude", name: "Claude Code", command: (p) => `claude "${p}"` },
  { key: "codex", name: "Codex", command: (p) => `codex "${p}"` },
  { key: "opencode", name: "OpenCode", command: (p) => `opencode --prompt "${p}"` },
  { key: "pi", name: "Pi", command: (p) => `pi "${p}"` },
];

/* Single line, no double quotes or `!` — it must survive verbatim inside
   the shell quoting above. */
function resumePrompt(rawUrl: string): string {
  return `You are resuming a conversation from Whirl. Fetch the raw markdown transcript at ${rawUrl}, read it fully, then continue the conversation from where it left off.`;
}

export function TranscriptHandoffDialog({
  shareId,
  open,
  onOpenChange,
}: {
  shareId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  /* raw.md is the route handler — plain markdown over HTTP, which is what
     a terminal agent's fetch actually needs (the /raw page is a
     client-rendered shell). */
  const rawUrl = `${threadShareUrl(shareId)}/raw.md`;
  const prompt = resumePrompt(rawUrl);

  const copy = (key: string, text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedKey(key);
        setTimeout(
          () => setCopiedKey((current) => (current === key ? null : current)),
          COPY_FLASH_MS,
        );
      })
      .catch(() => {
        /* Clipboard may be blocked (insecure context); the command text is
           still visible to select by hand. */
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Resume in a coding agent</DialogTitle>
          <DialogDescription className="text-[12.5px]/4.5">
            Run one of these in a terminal. The agent fetches the raw
            transcript and picks up right where this conversation left off.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-3 flex flex-col gap-1.5">
          {AGENTS.map((agent) => {
            const command = agent.command(prompt);
            return (
              <div
                key={agent.key}
                className="flex h-9 items-center gap-2 rounded-lg bg-well pr-1 pl-2.5 shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]"
              >
                <span className="flex w-26 shrink-0 items-center gap-1.5 text-[12.5px]/4 font-medium">
                  <AgentMark
                    mark={agent.key}
                    size={14}
                    className="text-muted-foreground"
                  />
                  {agent.name}
                </span>
                <code className="min-w-0 flex-1 truncate font-mono text-[11.5px]/4 text-muted-foreground">
                  {command}
                </code>
                <button
                  type="button"
                  aria-label={`Copy the ${agent.name} command`}
                  title={copiedKey === agent.key ? "Copied" : "Copy command"}
                  onClick={() => copy(agent.key, command)}
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
                >
                  {copiedKey === agent.key ? (
                    <IconCheck size={14} stroke={2.5} className="text-emerald-500" />
                  ) : (
                    <IconCopy size={14} stroke={2} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-3 border-t border-border pt-3">
          <div className="text-[11.5px]/4 font-medium text-muted-foreground">
            Raw transcript link
          </div>
          <div className="mt-1.5 flex h-9 items-center gap-1 rounded-lg bg-well pr-1 pl-2.5 shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]">
            <span className="min-w-0 flex-1 truncate text-[12.5px]/4 text-muted-foreground select-all">
              {rawUrl.replace(/^https?:\/\//, "")}
            </span>
            <button
              type="button"
              aria-label="Copy raw transcript link"
              title={copiedKey === "link" ? "Copied" : "Copy link"}
              onClick={() => copy("link", rawUrl)}
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
            >
              {copiedKey === "link" ? (
                <IconCircleCheckFilled size={15} className="text-emerald-500" />
              ) : (
                <IconCopy size={15} stroke={2} />
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
