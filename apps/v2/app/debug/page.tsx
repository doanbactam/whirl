"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildScenarios,
  fakeAssistant,
  fakeUser,
  FAKE_REPLY,
  FIXTURE_ARTIFACTS,
} from "@/components/debug/fixtures";
import { Composer } from "@/components/composer";
import { DebugSidebarRail } from "@/components/debug/sidebar-rail";
import { OpenSourceDialog } from "@/components/open-source/open-source-announcement";
import { useModelPref } from "@/lib/model-pref";
import { ArtifactPanel } from "@/components/thread/artifacts/artifact-panel";
import type { QueuedTurn } from "@/components/composer-queue";
import { ThreadView } from "@/components/thread/thread-view";
import { Toaster } from "@/components/toaster";
import { closeArtifactPanel } from "@/lib/artifact-panel";
import type { AttachmentUpload } from "@/lib/attachments";
import { FixtureArtifactsProvider } from "@/lib/live-artifacts";
import { computeIsGenerating, type ChatMessage } from "@/lib/messages";
import { showToast } from "@/lib/toasts";
import { cn } from "@/lib/utils";

/* /debug — the thread view on a workbench: every state it can wear, one
   pill away, plus a working composer that fakes a streamed reply so the
   whole loop (send → thinking → streaming → complete → stop) can be
   poked without a backend. Not linked from anywhere; it's a tool. */

const TICK_MS = 90;

export default function DebugPage() {
  const [model, setModel] = useModelPref();
  const scenarios = useMemo(() => buildScenarios(), []);
  const [scenarioKey, setScenarioKey] = useState(scenarios[0].key);
  const scenario =
    scenarios.find((entry) => entry.key === scenarioKey) ?? scenarios[0];

  /* Turns layered on top of the fixtures: composer sends and the fake
     streamer's output. Reset on every scenario hop (or pill re-click). */
  const [extraTurns, setExtraTurns] = useState<ChatMessage[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTicker = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const streamReplyInto = useCallback(
    (assistantId: string) => {
      stopTicker();
      const words = FAKE_REPLY.split(" ");
      let visible = 0;
      timerRef.current = setInterval(() => {
        visible = Math.min(
          words.length,
          visible + 1 + Math.floor(Math.random() * 3),
        );
        const done = visible >= words.length;
        if (done) stopTicker();
        setExtraTurns((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: words.slice(0, visible).join(" "),
                  status: done ? "complete" : "streaming",
                }
              : message,
          ),
        );
      }, TICK_MS);
    },
    [stopTicker],
  );

  const startTurn = useCallback(
    (prompt: string, attachments: AttachmentUpload[] = []) => {
      const userTurn = fakeUser(prompt);
      if (attachments.length > 0) {
        userTurn.attachments = attachments.map((file) => ({
          id: file.id,
          name: file.name,
          size: file.size,
          type: file.type,
        }));
      }
      const assistantTurn = fakeAssistant();
      setExtraTurns((current) => [...current, userTurn, assistantTurn]);
      /* A beat of "Thinking" before the words start — like the real one. */
      const delay = setTimeout(() => streamReplyInto(assistantTurn.id), 900);
      return () => clearTimeout(delay);
    },
    [streamReplyInto],
  );

  /* The queue, workbench edition: rows wait under the reply and nothing
     ever sends them — the scenario's streaming reply never settles, which
     is the point of looking at it. */
  const [queued, setQueued] = useState<QueuedTurn[]>([]);
  const [value, setValue] = useState("");
  const [announcementOpen, setAnnouncementOpen] = useState(false);

  /* Scenario switch: wipe the layered turns; the live scenario seeds
     itself with one self-running streamed turn. */
  const selectScenario = (key: string) => {
    stopTicker();
    closeArtifactPanel();
    setScenarioKey(key);
    setExtraTurns([]);
    const next = scenarios.find((entry) => entry.key === key);
    setQueued(next?.queued ?? []);
    setValue(next?.draft ?? "");
    if (next?.live) {
      startTurn("Stream me the markdown tour, live.");
    }
  };

  useEffect(() => stopTicker, [stopTicker]);

  const messages = useMemo(() => {
    if (scenario.messages === undefined) return undefined;
    return [...scenario.messages, ...extraTurns];
  }, [scenario, extraTurns]);

  const isGenerating = computeIsGenerating(messages);

  const submit = (
    text: string,
    _model: string,
    attachments: AttachmentUpload[],
  ) => {
    if (scenario.messages === undefined) return;
    setValue("");
    startTurn(text, attachments);
  };

  const queue = (text: string) => {
    setValue("");
    setQueued((current) => [
      ...current,
      { id: `debug-queued-${Date.now()}`, content: text },
    ]);
  };

  const stop = () => {
    stopTicker();
    setExtraTurns((current) => {
      const last = [...current]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" &&
            message.status !== "complete" &&
            message.status !== "stopped",
        );
      if (!last) return current;
      return current.map((message) =>
        message.id === last.id ? { ...message, status: "stopped" } : message,
      );
    });
  };

  return (
    <div className="flex h-dvh w-full flex-col gap-2 bg-background p-2">
      <header className="flex items-center gap-3 px-2 pt-1">
        <h1 className="text-[13.5px]/4 font-medium whitespace-nowrap">
          Thread view debug
        </h1>
        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto py-1">
          {scenarios.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => selectScenario(entry.key)}
              className={cn(
                "cursor-pointer rounded-full px-3 py-1.5 text-[13px]/4 font-medium whitespace-nowrap transition-colors duration-150",
                entry.key === scenario.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {entry.label}
            </button>
          ))}
        </nav>
        {/* The one-time announcement, on demand — the real one is gated
            on a localStorage flag. */}
        <button
          type="button"
          onClick={() => setAnnouncementOpen(true)}
          className="ml-auto cursor-pointer rounded-full px-3 py-1.5 text-[13px]/4 font-medium whitespace-nowrap text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
        >
          Open source modal
        </button>
      </header>
      <FixtureArtifactsProvider value={FIXTURE_ARTIFACTS}>
        {/* The rail sits beside the pane the way the real sidebar does —
            on the chrome, with the surface pane raised next to it. */}
        <div className="flex min-h-0 flex-1 gap-2">
          {scenario.rail && <DebugSidebarRail />}
          <main className="raised relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface">
            {/* min-w-0, like every other ThreadView host: without it a wide
                code block sets this column's floor and pushes the workbench
                past a phone's viewport, which is exactly the width the
                transcript most needs checking at. */}
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                <ThreadView
                  key={scenario.key}
                  messages={messages}
                  onRetryMessage={() =>
                    startTurn("Retry that last one, please.")
                  }
                  /* The checkpoint/edit affordances, sans backend: edits
                     stick to layered turns, the rest just wave. */
                  onEditMessage={(message, content) => {
                    setExtraTurns((current) =>
                      current.map((turn) =>
                        turn.id === message.id ? { ...turn, content } : turn,
                      ),
                    );
                    showToast("Saved. Nothing resends on the workbench.");
                  }}
                  onBranchMessage={() =>
                    showToast("Branching needs a real backend.")
                  }
                  onRollbackMessage={() =>
                    showToast("Rollback needs a real backend.")
                  }
                />
              </div>
              {/* In flow, exactly as the thread face docks it. */}
              <div className="pointer-events-none z-10 shrink-0 px-6 pb-4">
                <div className="pointer-events-auto mx-auto w-full max-w-2xl">
                  <Composer
                    value={value}
                    onValueChange={setValue}
                    onSubmit={submit}
                    model={model}
                    onModelChange={setModel}
                    floating
                    isGenerating={isGenerating}
                    onStop={stop}
                    onQueue={queue}
                    queued={queued}
                    onDequeue={(item) =>
                      setQueued((current) =>
                        current.filter((entry) => entry.id !== item.id),
                      )
                    }
                  />
                </div>
              </div>
            </div>
            <ArtifactPanel />
          </main>
        </div>
      </FixtureArtifactsProvider>
      <OpenSourceDialog
        open={announcementOpen}
        onOpenChange={setAnnouncementOpen}
      />
      <Toaster />
    </div>
  );
}
