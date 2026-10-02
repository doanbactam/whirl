import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { IconPlus, IconTrash, IconX } from "@tabler/icons-react";

import { MessageBubble } from "~/components/message-bubble";
import { Composer } from "~/components/composer";
import { ServerOverloadPill } from "~/components/server-overload";
import { OVERLOAD_SENTINEL } from "~/lib/server-load";
import type {
  Attachment,
  Message,
  MessageStatus,
  ModelKey,
  Phase,
  SearchSource,
} from "~/data/messages";

export const Route = createFileRoute("/debug")({
  component: DebugPage,
  head: () => ({
    meta: [
      { title: "Debug · Whirl" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const STATUSES: MessageStatus[] = [
  "thinking",
  "searching",
  "streaming",
  "complete",
  "stopped",
  "error",
];

const MODELS: ModelKey[] = ["Auto", "Fast", "Basic", "Max", "Image"];

const SAMPLE_MARKDOWN = `**Tung Tung Tung Sahur** is both a real-world Ramadan tradition and a recent TikTok meme:

- **Traditional use**

  In many Indonesian and Malaysian neighborhoods before dawn during Ramadan, volunteers walk around banging pots or drums and shouting "Tung-tung-tung sahoor!" to wake people so they can eat their pre-fast meal.

- **Internet twist (early 2023 → 2025)**

  On TikTok the phrase became an AI-generated meme called "Triple-T": an animated stick-figure made of wooden logs that appears only at sahoor time.

Here's a tiny code block too:

\`\`\`ts
const x: number = 42;
\`\`\``;

const SAMPLE_SOURCES: SearchSource[] = [
  {
    url: "https://en.wikipedia.org/wiki/Ramadan",
    title: "Ramadan — Wikipedia",
    author: "Wikipedia",
    publishedDate: "2025-03-01",
  },
  {
    url: "https://knowyourmeme.com/memes/tung-tung-tung-sahur",
    title: "Tung Tung Tung Sahur | Know Your Meme",
    author: "Know Your Meme",
    publishedDate: "2025-02-14",
  },
  {
    url: "https://example.com/tiktok-trend",
    title: "The Triple-T TikTok trend explained",
  },
];

// A self-contained stand-in for a generated picture (no network, loads
// instantly) so the skeleton → morph reveal is debuggable offline. 1024×640,
// so the slot visibly springs from its square placeholder to 16:10.
const SAMPLE_IMAGE_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="640"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a9efc"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="1024" height="640" fill="url(#g)"/><circle cx="780" cy="140" r="90" fill="#ffd166" opacity="0.9"/><path d="M0 500 L220 320 L400 470 L590 300 L800 480 L1024 360 V640 H0 Z" fill="#0b3b6b" opacity="0.7"/></svg>',
)}`;

let nextId = 1;
function makeId(prefix: string) {
  nextId += 1;
  return `${prefix}-${nextId}-${Date.now().toString(36)}`;
}

function makeMessage(overrides: Partial<Message> & { role: Message["role"] }): Message {
  return {
    id: makeId(overrides.role),
    role: overrides.role,
    content: overrides.content ?? "",
    createdAt: overrides.createdAt ?? Date.now(),
    attachments: overrides.attachments,
    status: overrides.status,
    phases: overrides.phases,
    streamId: overrides.streamId,
    model: overrides.model,
    thinking: overrides.thinking,
    search: overrides.search,
  };
}

const PRESETS: { label: string; build: () => Message }[] = [
  {
    label: "User · plain",
    build: () =>
      makeMessage({
        role: "user",
        content: "What's the deal with the Tung Tung Tung Sahur meme?",
      }),
  },
  {
    label: "User · with attachment",
    build: () =>
      makeMessage({
        role: "user",
        content: "Can you summarize this PDF?",
        attachments: [
          {
            id: makeId("att"),
            name: "ramadan-traditions.pdf",
            size: 248_312,
            type: "application/pdf",
          },
          {
            id: makeId("att"),
            name: "notes.txt",
            size: 1_204,
            type: "text/plain",
            text: "Some text content here.",
          },
        ],
      }),
  },
  {
    label: "Assistant · thinking",
    build: () =>
      makeMessage({
        role: "assistant",
        content: "",
        status: "thinking",
        phases: [],
        thinking: true,
      }),
  },
  {
    label: "Assistant · fetching (pending)",
    build: () =>
      makeMessage({
        role: "assistant",
        content: "Let me pull up that page for you.",
        status: "streaming",
        phases: [
          {
            kind: "fetch",
            sources: 0,
            contentOffset: 35,
            pending: true,
          },
        ],
      }),
  },
  {
    label: "Assistant · searching (pending)",
    build: () =>
      makeMessage({
        role: "assistant",
        content:
          "Let me find the specific story behind the \"67\" meme you saw.",
        status: "streaming",
        phases: [
          {
            kind: "search",
            sources: 0,
            contentOffset: 70,
            query: "story behind the 67 meme",
            pending: true,
          },
        ],
        search: true,
      }),
  },
  {
    label: "Assistant · streaming",
    build: () =>
      makeMessage({
        role: "assistant",
        content: SAMPLE_MARKDOWN.slice(0, 220),
        status: "streaming",
        phases: [],
      }),
  },
  {
    label: "Assistant · with thought + search",
    build: () =>
      makeMessage({
        role: "assistant",
        content: SAMPLE_MARKDOWN,
        status: "complete",
        phases: [
          { kind: "thought", durationMs: 4200, contentOffset: 0 },
          {
            kind: "search",
            sources: SAMPLE_SOURCES.length,
            items: SAMPLE_SOURCES,
            contentOffset: 64,
            query: "tung tung tung sahur meme origin",
          },
        ],
        thinking: true,
        search: true,
      }),
  },
  {
    label: "Assistant · image (generating)",
    build: () =>
      makeMessage({
        role: "assistant",
        content: "",
        status: "streaming",
        phases: [],
        model: "Image",
      }),
  },
  {
    label: "Assistant · image (done)",
    build: () =>
      makeMessage({
        role: "assistant",
        content: "",
        status: "complete",
        phases: [],
        model: "Image",
        attachments: [
          {
            id: makeId("att"),
            name: "generated-image.png",
            size: 1_842_004,
            type: "image/png",
            url: SAMPLE_IMAGE_URL,
          },
        ],
      }),
  },
  {
    label: "Assistant · stopped",
    build: () =>
      makeMessage({
        role: "assistant",
        content: "I was going to say something useful when",
        status: "stopped",
      }),
  },
  {
    label: "Assistant · error",
    build: () =>
      makeMessage({
        role: "assistant",
        content: "",
        status: "error",
      }),
  },
  {
    label: "Assistant · server overload",
    build: () =>
      makeMessage({
        role: "assistant",
        content: OVERLOAD_SENTINEL,
        status: "error",
      }),
  },
];

function defaultMessages(): Message[] {
  return [PRESETS[0].build(), PRESETS[5].build()];
}

function DebugPage() {
  const [messages, setMessages] = useState<Message[]>(defaultMessages);
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark"),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    messages[0]?.id ?? null,
  );
  // Preview the under-composer "servers under extra load" notice. In the real
  // app it shows for free users while the throttle is engaged (driven by the
  // serverLoad query); here we force it so the state is debuggable in isolation.
  const [overloadPreview, setOverloadPreview] = useState(false);

  const selected = useMemo(
    () => messages.find((m) => m.id === selectedId) ?? null,
    [messages, selectedId],
  );

  const updateMessage = (id: string, patch: Partial<Message>) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  };

  const removeMessage = (id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  const addPreset = (preset: (typeof PRESETS)[number]) => {
    const next = preset.build();
    setMessages((prev) => [...prev, next]);
    setSelectedId(next.id);
  };

  const toggleDark = () => {
    const nextDark = !dark;
    setDark(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
  };

  return (
    <div
      className={`flex h-dvh w-full bg-[#f8f8fa] text-neutral-900 dark:bg-[#171718] dark:text-neutral-100`}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-3 dark:border-white/[0.06]">
          <div className="flex items-center gap-3">
            <span className="text-[15px] font-semibold tracking-tight">
              Debug
            </span>
            <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-white/[0.08] dark:text-neutral-300">
              {messages.length} message{messages.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOverloadPreview((v) => !v)}
              className={`rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                overloadPreview
                  ? "border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/[0.12] dark:text-amber-200"
                  : "border-black/[0.08] bg-white/60 hover:bg-white dark:border-white/[0.08] dark:bg-[#1E1E1E]/60 dark:hover:bg-[#1E1E1E]"
              }`}
            >
              Overload
            </button>
            <button
              type="button"
              onClick={toggleDark}
              className="rounded-md border border-black/[0.08] bg-white/60 px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-white dark:border-white/[0.08] dark:bg-[#1E1E1E]/60 dark:hover:bg-[#1E1E1E]"
            >
              {dark ? "Light" : "Dark"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setSelectedId(null);
              }}
              className="rounded-md border border-black/[0.08] bg-white/60 px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-white dark:border-white/[0.08] dark:bg-[#1E1E1E]/60 dark:hover:bg-[#1E1E1E]"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setMessages(defaultMessages())}
              className="rounded-md border border-black/[0.08] bg-white/60 px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-white dark:border-white/[0.08] dark:bg-[#1E1E1E]/60 dark:hover:bg-[#1E1E1E]"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="chat-scroll min-h-0 flex-1 overflow-y-auto rounded-none bg-[#F4F4F6] dark:bg-[#141415]">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pt-8 pb-40">
              {messages.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-[13px] text-neutral-500 dark:text-neutral-400">
                  No messages. Add one from the panel →
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className={`cursor-pointer rounded-2xl p-2 transition-colors ${
                      selectedId === m.id
                        ? "bg-[#178dfb]/10 ring-1 ring-[#178dfb]/40"
                        : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                    }`}
                  >
                    <MessageBubble
                      message={m}
                      onEdit={
                        m.role === "user"
                          ? (content) => updateMessage(m.id, { content })
                          : undefined
                      }
                      onRetry={() => {
                        updateMessage(m.id, {
                          status:
                            m.role === "assistant" ? "streaming" : m.status,
                        });
                      }}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto w-full max-w-2xl px-4 pb-6 [&>*]:pointer-events-auto">
            {overloadPreview && (
              <div className="mb-2 flex justify-center">
                <ServerOverloadPill remaining={3} cap={10} />
              </div>
            )}
            <Composer
              variant="thread"
              isGenerating={messages.some(
                (m) =>
                  m.role === "assistant" &&
                  (m.status === "thinking" ||
                    m.status === "searching" ||
                    m.status === "streaming"),
              )}
              onSubmit={(value, _files, options) => {
                if (!value.trim()) return;
                const user = makeMessage({
                  role: "user",
                  content: value,
                });
                const assistant = makeMessage({
                  role: "assistant",
                  content: "",
                  status: options.thinking ? "thinking" : "streaming",
                  phases: [],
                  model: options.model,
                  thinking: options.thinking,
                  search: options.search,
                });
                setMessages((prev) => [...prev, user, assistant]);
                setSelectedId(assistant.id);
              }}
              onStop={() => {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.role === "assistant" &&
                    (m.status === "thinking" ||
                      m.status === "searching" ||
                      m.status === "streaming")
                      ? { ...m, status: "stopped" }
                      : m,
                  ),
                );
              }}
            />
          </div>
        </div>
      </div>

      <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-black/[0.06] bg-white dark:border-white/[0.06] dark:bg-[#1A1A1A]">
        <div className="border-b border-black/[0.06] px-4 py-3 dark:border-white/[0.06]">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Add preset
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => addPreset(p)}
                className="flex items-center gap-1.5 rounded-md border border-black/[0.08] bg-white/50 px-2 py-1.5 text-left text-[11.5px] font-medium text-neutral-700 transition-colors hover:bg-black/[0.04] dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-neutral-200 dark:hover:bg-white/[0.06]"
              >
                <IconPlus size={12} stroke={2.5} />
                <span className="truncate">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {selected ? (
            <MessageEditor
              key={selected.id}
              message={selected}
              onChange={(patch) => updateMessage(selected.id, patch)}
              onRemove={() => removeMessage(selected.id)}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-[12.5px] text-neutral-500 dark:text-neutral-400">
              Select a message in the preview to edit its state, or add a
              preset above.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function MessageEditor({
  message,
  onChange,
  onRemove,
}: {
  message: Message;
  onChange: (patch: Partial<Message>) => void;
  onRemove: () => void;
}) {
  const phases = message.phases ?? [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${
              message.role === "user"
                ? "bg-[#178dfb]/15 text-[#178dfb]"
                : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            }`}
          >
            {message.role}
          </span>
          <span className="font-mono text-[10.5px] text-neutral-400 dark:text-neutral-500">
            {message.id.slice(0, 12)}
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Delete message"
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-red-500/10 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400"
        >
          <IconTrash size={14} stroke={2} />
        </button>
      </div>

      <Field label="Content">
        <textarea
          value={message.content}
          onChange={(e) => onChange({ content: e.target.value })}
          rows={6}
          className="w-full resize-y rounded-md border border-black/[0.08] bg-white px-2 py-1.5 font-mono text-[12px] leading-5 text-neutral-800 focus:border-[#178dfb] focus:outline-none focus:ring-1 focus:ring-[#178dfb]/40 dark:border-white/[0.08] dark:bg-[#222] dark:text-neutral-100"
          placeholder="Markdown content..."
        />
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={() => onChange({ content: SAMPLE_MARKDOWN })}
            className="text-[10.5px] font-medium text-[#178dfb] hover:underline"
          >
            Use markdown sample
          </button>
        </div>
      </Field>

      {message.role === "assistant" && (
        <>
          <Field label="Status">
            <div className="flex flex-wrap gap-1">
              {[undefined, ...STATUSES].map((s) => (
                <button
                  key={s ?? "none"}
                  type="button"
                  onClick={() => onChange({ status: s })}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    message.status === s
                      ? "bg-[#178dfb] text-white"
                      : "bg-black/[0.05] text-neutral-700 hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-neutral-200 dark:hover:bg-white/[0.1]"
                  }`}
                >
                  {s ?? "none"}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Model">
            <div className="flex flex-wrap gap-1">
              {MODELS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChange({ model: m })}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    message.model === m
                      ? "bg-[#178dfb] text-white"
                      : "bg-black/[0.05] text-neutral-700 hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-neutral-200 dark:hover:bg-white/[0.1]"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Flags">
            <div className="flex gap-3">
              <Toggle
                label="thinking"
                value={message.thinking ?? false}
                onChange={(v) => onChange({ thinking: v })}
              />
              <Toggle
                label="search"
                value={message.search ?? false}
                onChange={(v) => onChange({ search: v })}
              />
            </div>
          </Field>

          <Field label="Phases">
            <div className="flex flex-col gap-2">
              {phases.length === 0 && (
                <div className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
                  No phases.
                </div>
              )}
              {phases.map((p, i) => (
                <PhaseEditor
                  key={`p-${i}`}
                  phase={p}
                  contentLength={message.content.length}
                  onChange={(next) => {
                    const updated = phases.map((existing, idx) =>
                      idx === i ? next : existing,
                    );
                    onChange({ phases: updated });
                  }}
                  onRemove={() => {
                    onChange({
                      phases: phases.filter((_, idx) => idx !== i),
                    });
                  }}
                />
              ))}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onChange({
                      phases: [
                        ...phases,
                        {
                          kind: "thought",
                          durationMs: 3000,
                          contentOffset: 0,
                        },
                      ],
                    });
                  }}
                  className="flex-1 rounded-md border border-dashed border-black/[0.15] px-2 py-1 text-[11px] font-medium text-neutral-600 transition-colors hover:bg-black/[0.04] dark:border-white/[0.15] dark:text-neutral-300 dark:hover:bg-white/[0.04]"
                >
                  + thought
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange({
                      phases: [
                        ...phases,
                        {
                          kind: "search",
                          sources: 0,
                          contentOffset: message.content.length,
                          query: "example search",
                          pending: true,
                        },
                      ],
                    });
                  }}
                  className="flex-1 rounded-md border border-dashed border-black/[0.15] px-2 py-1 text-[11px] font-medium text-neutral-600 transition-colors hover:bg-black/[0.04] dark:border-white/[0.15] dark:text-neutral-300 dark:hover:bg-white/[0.04]"
                >
                  + search (pending)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange({
                      phases: [
                        ...phases,
                        {
                          kind: "search",
                          sources: SAMPLE_SOURCES.length,
                          items: SAMPLE_SOURCES,
                          contentOffset: message.content.length,
                          query: "example search",
                        },
                      ],
                    });
                  }}
                  className="flex-1 rounded-md border border-dashed border-black/[0.15] px-2 py-1 text-[11px] font-medium text-neutral-600 transition-colors hover:bg-black/[0.04] dark:border-white/[0.15] dark:text-neutral-300 dark:hover:bg-white/[0.04]"
                >
                  + search (done)
                </button>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onChange({
                      phases: [
                        ...phases,
                        {
                          kind: "calc",
                          expression:
                            "(1500 * 0.05/12) / (1 - (1 + 0.05/12)^(-360))",
                          result: "8051.53",
                          label: "monthly payment",
                          needsLatex: true,
                          expressionTex:
                            "\\frac{1500\\cdot\\frac{0.05}{12}}{1-\\left(1+\\frac{0.05}{12}\\right)^{-360}}",
                          resultTex: "8051.53",
                          contentOffset: message.content.length,
                        },
                      ],
                    });
                  }}
                  className="flex-1 rounded-md border border-dashed border-black/[0.15] px-2 py-1 text-[11px] font-medium text-neutral-600 transition-colors hover:bg-black/[0.04] dark:border-white/[0.15] dark:text-neutral-300 dark:hover:bg-white/[0.04]"
                >
                  + calc (chip)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange({
                      phases: [
                        ...phases,
                        {
                          kind: "calc",
                          contentOffset: message.content.length,
                          pending: true,
                        },
                      ],
                    });
                  }}
                  className="flex-1 rounded-md border border-dashed border-black/[0.15] px-2 py-1 text-[11px] font-medium text-neutral-600 transition-colors hover:bg-black/[0.04] dark:border-white/[0.15] dark:text-neutral-300 dark:hover:bg-white/[0.04]"
                >
                  + calc (pending)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange({
                      phases: [
                        ...phases,
                        {
                          kind: "calc",
                          label: "worksheet answers",
                          items: [
                            { expression: "12 * 9", result: "108", label: "1a" },
                            {
                              expression: "sqrt(144)",
                              result: "12",
                              label: "1b",
                              needsLatex: true,
                              expressionTex: "\\sqrt{144}",
                              resultTex: "12",
                            },
                            {
                              expression: "3/4 + 1/6",
                              result: "0.9166666667",
                              label: "2",
                            },
                            {
                              expression: "log(0)",
                              label: "3",
                              error: "undefined value",
                            },
                          ],
                          contentOffset: message.content.length,
                        },
                      ],
                    });
                  }}
                  className="flex-1 rounded-md border border-dashed border-black/[0.15] px-2 py-1 text-[11px] font-medium text-neutral-600 transition-colors hover:bg-black/[0.04] dark:border-white/[0.15] dark:text-neutral-300 dark:hover:bg-white/[0.04]"
                >
                  + calc (batch)
                </button>
              </div>
            </div>
          </Field>
        </>
      )}

      <Field label="Attachments">
        <div className="flex flex-col gap-2">
          {(message.attachments ?? []).map((a, i) => (
            <AttachmentEditor
              key={a.id}
              attachment={a}
              onChange={(next) => {
                const list = message.attachments ?? [];
                onChange({
                  attachments: list.map((x, idx) => (idx === i ? next : x)),
                });
              }}
              onRemove={() => {
                onChange({
                  attachments: (message.attachments ?? []).filter(
                    (_, idx) => idx !== i,
                  ),
                });
              }}
            />
          ))}
          <button
            type="button"
            onClick={() =>
              onChange({
                attachments: [
                  ...(message.attachments ?? []),
                  {
                    id: makeId("att"),
                    name: "new-file.pdf",
                    size: 1024 * 30,
                    type: "application/pdf",
                  },
                ],
              })
            }
            className="rounded-md border border-dashed border-black/[0.15] px-2 py-1 text-[11px] font-medium text-neutral-600 transition-colors hover:bg-black/[0.04] dark:border-white/[0.15] dark:text-neutral-300 dark:hover:bg-white/[0.04]"
          >
            + attachment
          </button>
        </div>
      </Field>

      <Field label="Raw JSON">
        <pre className="max-h-48 overflow-auto rounded-md border border-black/[0.08] bg-black/[0.03] p-2 font-mono text-[10.5px] leading-4 text-neutral-700 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-neutral-300">
{JSON.stringify(message, null, 2)}
        </pre>
      </Field>
    </div>
  );
}

function PhaseEditor({
  phase,
  contentLength,
  onChange,
  onRemove,
}: {
  phase: Phase;
  contentLength: number;
  onChange: (next: Phase) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-black/[0.08] bg-black/[0.02] p-2 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              onChange(
                phase.kind === "thought"
                  ? {
                      kind: "search",
                      sources: 0,
                      contentOffset: phase.contentOffset,
                      query: "example",
                      pending: true,
                    }
                  : {
                      kind: "thought",
                      durationMs: 3000,
                      contentOffset: phase.contentOffset,
                    },
              )
            }
            className={`rounded-sm px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${
              phase.kind === "thought"
                ? "bg-purple-500/15 text-purple-700 dark:text-purple-300"
                : phase.kind === "calc"
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-sky-500/15 text-sky-700 dark:text-sky-300"
            }`}
            title="Click to swap kind"
          >
            {phase.kind}
          </button>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-red-500/10 hover:text-red-600 dark:text-neutral-400"
        >
          <IconX size={12} stroke={2} />
        </button>
      </div>

      <NumberField
        label="contentOffset"
        value={phase.contentOffset}
        onChange={(v) =>
          onChange({ ...phase, contentOffset: v } as Phase)
        }
        max={contentLength}
      />

      {phase.kind === "thought" ? (
        <NumberField
          label="durationMs"
          value={phase.durationMs}
          onChange={(v) => onChange({ ...phase, durationMs: v })}
          min={0}
        />
      ) : phase.kind === "calc" ? (
        <>
          <TextField
            label="expression"
            value={phase.expression ?? ""}
            onChange={(v) => onChange({ ...phase, expression: v || undefined })}
          />
          <TextField
            label="result"
            value={phase.result ?? ""}
            onChange={(v) => onChange({ ...phase, result: v || undefined })}
          />
          <TextField
            label="label"
            value={phase.label ?? ""}
            onChange={(v) => onChange({ ...phase, label: v || undefined })}
          />
          <TextField
            label="expressionTex"
            value={phase.expressionTex ?? ""}
            onChange={(v) =>
              onChange({ ...phase, expressionTex: v || undefined })
            }
          />
          <TextField
            label="resultTex"
            value={phase.resultTex ?? ""}
            onChange={(v) => onChange({ ...phase, resultTex: v || undefined })}
          />
          <Toggle
            label="needsLatex"
            value={phase.needsLatex ?? false}
            onChange={(v) => onChange({ ...phase, needsLatex: v || undefined })}
          />
          <Toggle
            label="pending"
            value={phase.pending ?? false}
            onChange={(v) => onChange({ ...phase, pending: v || undefined })}
          />
        </>
      ) : phase.kind === "search" ? (
        <>
          <TextField
            label="query"
            value={phase.query ?? ""}
            onChange={(v) => onChange({ ...phase, query: v || undefined })}
          />
          <NumberField
            label="sources"
            value={phase.sources}
            onChange={(v) => onChange({ ...phase, sources: v })}
            min={0}
          />
          <Toggle
            label="pending"
            value={phase.pending ?? false}
            onChange={(v) => onChange({ ...phase, pending: v || undefined })}
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...phase,
                  items: SAMPLE_SOURCES,
                  sources: SAMPLE_SOURCES.length,
                })
              }
              className="rounded-md bg-black/[0.05] px-2 py-1 text-[10.5px] font-medium text-neutral-700 hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-neutral-200 dark:hover:bg-white/[0.1]"
            >
              Use sample sources
            </button>
            <button
              type="button"
              onClick={() =>
                onChange({ ...phase, items: undefined })
              }
              className="rounded-md bg-black/[0.05] px-2 py-1 text-[10.5px] font-medium text-neutral-700 hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-neutral-200 dark:hover:bg-white/[0.1]"
            >
              Clear items
            </button>
          </div>
          {phase.items && (
            <div className="text-[10.5px] text-neutral-500 dark:text-neutral-400">
              {phase.items.length} item{phase.items.length === 1 ? "" : "s"}
            </div>
          )}
        </>
      ) : phase.kind === "fetch" ? (
        <>
          <NumberField
            label="sources"
            value={phase.sources}
            onChange={(v) => onChange({ ...phase, sources: v })}
            min={0}
          />
          <Toggle
            label="pending"
            value={phase.pending ?? false}
            onChange={(v) => onChange({ ...phase, pending: v || undefined })}
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...phase,
                  items: SAMPLE_SOURCES,
                  sources: SAMPLE_SOURCES.length,
                })
              }
              className="rounded-md bg-black/[0.05] px-2 py-1 text-[10.5px] font-medium text-neutral-700 hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-neutral-200 dark:hover:bg-white/[0.1]"
            >
              Use sample sources
            </button>
            <button
              type="button"
              onClick={() =>
                onChange({ ...phase, items: undefined })
              }
              className="rounded-md bg-black/[0.05] px-2 py-1 text-[10.5px] font-medium text-neutral-700 hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-neutral-200 dark:hover:bg-white/[0.1]"
            >
              Clear items
            </button>
          </div>
          {phase.items && (
            <div className="text-[10.5px] text-neutral-500 dark:text-neutral-400">
              {phase.items.length} item{phase.items.length === 1 ? "" : "s"}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function AttachmentEditor({
  attachment,
  onChange,
  onRemove,
}: {
  attachment: Attachment;
  onChange: (next: Attachment) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-black/[0.08] bg-black/[0.02] p-2 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10.5px] text-neutral-400">
          {attachment.id.slice(0, 12)}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-red-500/10 hover:text-red-600 dark:text-neutral-400"
        >
          <IconX size={12} stroke={2} />
        </button>
      </div>
      <TextField
        label="name"
        value={attachment.name}
        onChange={(v) => onChange({ ...attachment, name: v })}
      />
      <TextField
        label="type"
        value={attachment.type}
        onChange={(v) => onChange({ ...attachment, type: v })}
      />
      <NumberField
        label="size"
        value={attachment.size}
        onChange={(v) => onChange({ ...attachment, size: v })}
        min={0}
      />
      <TextField
        label="url"
        value={attachment.url ?? ""}
        onChange={(v) => onChange({ ...attachment, url: v || undefined })}
      />
      <TextField
        label="skippedReason"
        value={attachment.skippedReason ?? ""}
        onChange={(v) =>
          onChange({ ...attachment, skippedReason: v || undefined })
        }
      />
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      {children}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <span className="w-24 shrink-0 text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded-sm border border-black/[0.08] bg-white px-1.5 py-0.5 font-mono text-[11px] focus:border-[#178dfb] focus:outline-none dark:border-white/[0.08] dark:bg-[#222]"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <span className="w-24 shrink-0 text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      <input
        type="number"
        value={value ?? 0}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 rounded-sm border border-black/[0.08] bg-white px-1.5 py-0.5 font-mono text-[11px] focus:border-[#178dfb] focus:outline-none dark:border-white/[0.08] dark:bg-[#222]"
      />
    </label>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
        value
          ? "bg-[#178dfb] text-white"
          : "bg-black/[0.05] text-neutral-700 hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-neutral-200 dark:hover:bg-white/[0.1]"
      }`}
    >
      <span
        aria-hidden
        className={`flex h-3 w-3 items-center justify-center rounded-sm ${
          value ? "bg-white/30" : "bg-black/10 dark:bg-white/10"
        }`}
      />
      {label}
    </button>
  );
}
