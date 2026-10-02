import { jsonSchema, tool, type Tool } from "ai";

// The model's gateway to the user's installed skills, mirroring the MCP
// gateway pattern (see mcp.ts): the system prompt carries only each skill's
// name + description, and the full instruction text is fetched on demand —
// so a turn that never needs a skill pays nothing for having them installed.

/** The gateway tool that pulls one skill's instructions into the turn. */
export const LOAD_SKILL_NAME = "load_skill";

/** One installed skill as the prompt knows it. */
export type SkillSummary = { name: string; description?: string };

const installedNames = (skills: SkillSummary[]) =>
  skills.map((s) => `"${s.name}"`).join(", ");

/**
 * Build the load_skill tool for one turn. `fetchSkill` resolves a skill's
 * text (verifying the install server-side); `onLoaded` persists the outcome —
 * every exit path calls it so the chat's pending "Learning a skill" chip
 * always settles instead of dangling. Loaded texts are cached per turn so a
 * repeat call doesn't re-emit thousands of characters into context.
 */
export function createLoadSkillTool({
  skills,
  preloaded,
  fetchSkill,
  onLoaded,
}: {
  skills: SkillSummary[];
  /** Names of skills whose instructions are already in the system prompt
   * (@mentioned) — loading one of these just points back at the prompt. */
  preloaded?: string[];
  fetchSkill: (
    name: string,
  ) => Promise<{ name: string; instructions: string } | null>;
  onLoaded: (info: {
    name: string;
    ok: boolean;
    error?: string;
  }) => Promise<void>;
}): Tool {
  // One fetch per skill per turn: a repeat load points back at the text
  // already in context instead of duplicating it. Mentioned skills arrive
  // pre-seeded — their text already rides the system prompt.
  const loaded = new Set<string>(
    (preloaded ?? []).map((name) => name.toLowerCase()),
  );

  return tool({
    description: "Load an installed skill's instructions.",
    inputSchema: jsonSchema<{ skill: string }>({
      type: "object",
      properties: {
        skill: {
          type: "string",
          description: "Exact listed skill name.",
        },
      },
      required: ["skill"],
    }),
    execute: async ({ skill }) => {
      const fail = async (name: string, error: string) => {
        await onLoaded({ name, ok: false, error });
        return `Couldn't load "${name}": ${error}`;
      };
      const summary = skills.find(
        (s) => s.name.trim().toLowerCase() === skill.trim().toLowerCase(),
      );
      if (!summary) {
        return fail(
          skill,
          skills.length > 0
            ? `no skill by that name — installed skills: ${installedNames(skills)}`
            : "the user has no skills installed",
        );
      }
      const cacheKey = summary.name.toLowerCase();
      if (loaded.has(cacheKey)) {
        await onLoaded({ name: summary.name, ok: true });
        return `You already loaded "${summary.name}" this turn — its instructions are above. Follow them.`;
      }
      let result: { name: string; instructions: string } | null;
      try {
        result = await fetchSkill(summary.name);
      } catch {
        return fail(summary.name, "the skill could not be fetched right now");
      }
      if (!result) {
        return fail(summary.name, "this skill isn't available anymore");
      }
      loaded.add(cacheKey);
      await onLoaded({ name: result.name, ok: true });
      return [
        `Loaded the "${result.name}" skill. Follow these instructions for the rest of the turn:`,
        "",
        result.instructions,
      ].join("\n");
    },
  });
}
