import { parseJsonc } from "~/lib/jsonc";
import type { ToolDraft } from "~/pages/integrations/tool-scan-section";

/**
 * Renders the tools as a commented JSONC template developers can fill out
 * offline: one entry per tool, the server's own blurb as a hint comment, and
 * the two phrase fields exactly as the form wants them back.
 */
export function toolsToJsonc(tools: ToolDraft[]): string {
  const lines = [
    "// Whirl tool descriptions",
    "//",
    "// Each key below is a tool advertised by your MCP server. Fill in both",
    "// fields for every tool — these show up in the chat while Whirl uses it:",
    '//   "description" — while the tool runs, e.g. "Searching your issues"',
    '//   "completed"   — once it finishes, e.g. "Searched your issues"',
    "//",
    "// Keep them short and human: store users read these, not developers.",
    "// When you're done, upload this file back in the Tools section of the",
    "// console. Comments and trailing commas are fine — it's JSONC. Plain",
    "// JSON works too, if comments aren't your thing.",
    "{",
  ];
  tools.forEach((tool, i) => {
    if (i > 0) lines.push("");
    if (tool.serverDescription) {
      const blurb = tool.serverDescription.replace(/\s+/g, " ").trim();
      lines.push(`  // Server says: ${blurb}`);
    }
    lines.push(
      `  ${JSON.stringify(tool.name)}: {`,
      `    "description": ${JSON.stringify(tool.description)},`,
      `    "completed": ${JSON.stringify(tool.completed)}`,
      `  }${i < tools.length - 1 ? "," : ""}`,
    );
  });
  lines.push("}", "");
  return lines.join("\n");
}

export type ToolFileImport =
  | { ok: true; tools: ToolDraft[]; matched: number; added: number }
  | { ok: false; error: string };

/**
 * Parses an uploaded tool file and merges it into the current drafts: known
 * names get their phrases filled in, unknown names join the list as manual
 * tools, and tools the file doesn't mention are left untouched.
 */
export function mergeToolsFromJsonc(
  text: string,
  existing: ToolDraft[] | null,
): ToolFileImport {
  let parsed: unknown;
  try {
    parsed = parseJsonc(text);
  } catch {
    return {
      ok: false,
      error:
        "That file isn't valid JSON (or JSONC) — fix the syntax and try again.",
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: "Expected an object mapping tool names to their phrases.",
    };
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, error: "The file doesn't have any tools in it." };
  }

  const tools = (existing ?? []).map((t) => ({ ...t }));
  let matched = 0;
  let added = 0;
  for (const [name, value] of entries) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return {
        ok: false,
        error: `"${name}" should be an object with "description" and "completed".`,
      };
    }
    const { description, completed } = value as Record<string, unknown>;
    if (description !== undefined && typeof description !== "string") {
      return { ok: false, error: `"${name}" has a non-text "description".` };
    }
    if (completed !== undefined && typeof completed !== "string") {
      return { ok: false, error: `"${name}" has a non-text "completed".` };
    }
    const index = tools.findIndex((t) => t.name === name);
    if (index >= 0) {
      const current = tools[index]!;
      tools[index] = {
        ...current,
        description: description ?? current.description,
        completed: completed ?? current.completed,
      };
      matched++;
    } else {
      tools.push({
        name,
        description: description ?? "",
        completed: completed ?? "",
        manual: true,
      });
      added++;
    }
  }
  return { ok: true, tools, matched, added };
}
