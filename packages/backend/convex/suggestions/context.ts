import type { SupermemoryPromptContext } from "../supermemory";
import { shuffle } from "./random";
import type { RecentThread } from "./types";

/** What the suggester knows about a user. Both halves are supplied whenever
 * both exist: Supermemory holds the durable picture (tastes, long-running
 * projects), recent threads hold what they are actually doing this week. One
 * without the other produces starters that are either vague or myopic. */
export type SuggestionContext = {
  memory: SupermemoryPromptContext | null;
  threads: RecentThread[];
};

export type ContextSource = "memory" | "threads" | "memory+threads" | "none";

const NO_CONTEXT =
  "Nothing is known about this user yet. Offer broadly useful starters that would suit anyone opening a new assistant.";

export function hasMemory(
  context: SupermemoryPromptContext | null,
): context is SupermemoryPromptContext {
  return (
    context !== null &&
    (context.staticFacts.length > 0 ||
      context.dynamicFacts.length > 0 ||
      context.memories.length > 0)
  );
}

export function contextSource({ memory, threads }: SuggestionContext): ContextSource {
  const withMemory = hasMemory(memory);
  if (withMemory && threads.length > 0) return "memory+threads";
  if (withMemory) return "memory";
  if (threads.length > 0) return "threads";
  return "none";
}

function memoryLines(context: SupermemoryPromptContext) {
  /* Shuffled within each kind: the profile comes back in a stable order, and
     an unchanging context is what makes two requests answer identically. */
  return [
    ...shuffle(context.staticFacts).map((fact) => `- ${fact}`),
    ...shuffle(context.dynamicFacts).map((fact) => `- ${fact}`),
    ...shuffle(context.memories).map((memory) => `- ${memory}`),
  ];
}

function threadLines(threads: RecentThread[]) {
  return threads.map((thread) => {
    const latest = thread.latest ? `\n  Latest ask: "${thread.latest}"` : "";
    return `- ${thread.title}\n  Opened with: "${thread.opener}"${latest}`;
  });
}

/** Renders the context as the two labelled sections the prompt refers to. */
export function formatSuggestionContext(context: SuggestionContext) {
  const sections: string[] = [];

  const { memory } = context;
  if (hasMemory(memory)) {
    sections.push(
      ["What we know about them:", ...memoryLines(memory)].join("\n"),
    );
  }
  if (context.threads.length > 0) {
    sections.push(
      [
        "What they have been working on recently (newest first):",
        ...threadLines(context.threads),
      ].join("\n"),
    );
  }

  return sections.length > 0 ? sections.join("\n\n") : NO_CONTEXT;
}
