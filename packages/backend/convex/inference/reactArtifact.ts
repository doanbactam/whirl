import { jsonSchema, tool } from "ai";

import type { Id } from "../_generated/dataModel";
import type { ArtifactBinding } from "../validators";
import { FULL_PAGE_DESIGN_NOTES } from "./designTasteSkill";

/**
 * `createReactArtifact` — the model writes a JSX module instead of raw markup.
 *
 * The body streams into the same `htmlArtifacts` row an HTML artifact uses
 * (with `runtime: "react"`), so share tokens, the side panel, find/replace
 * edits, and the streaming lifecycle all come along for free. What changes is
 * the render path: the host compiles the module with Sucrase and mounts it
 * inside the sandbox against a prebuilt React + Tailwind + Recharts bundle.
 *
 * Data bindings are declared HERE, in the tool call — never reached for from
 * inside the artifact's code. The host executes them. That asymmetry is the
 * whole security model: a model-written page can render the user's Linear
 * issues, but it cannot decide to go read their mail.
 */

const MAX_TITLE_LENGTH = 120;
const MAX_CODE_LENGTH = 200_000;
const MAX_BINDINGS = 8;
const MAX_BINDING_ARGS_LENGTH = 4_000;

/** What gets persisted onto the assistant message's `html` phase. */
export type ReactPhasePayload = {
  op: "create";
  mode: "inline" | "full";
  htmlId: Id<"htmlArtifacts">;
  title: string;
  bindingCount: number;
};

/**
 * The technical contract, embedded in the tool's input-schema description so
 * it only costs context in the moment the model is actually writing a module.
 * Deliberately mechanical — what compiles and what renders, not what it should
 * look like. Keep in sync with the frame runtime's `require` shim
 * (apps/v2/artifact-runtime/index.tsx).
 */
export const REACT_RUNTIME_REFERENCE = `Module rules:
- Write ONE complete ES module ending in \`export default function App() { ... }\`. No markdown fence, no <html>, no ReactDOM.render call — the host mounts App itself.
- Imports resolve from a fixed set and nothing else: \`react\` (all hooks), \`recharts\`, and \`@whirl/data\` (see Data below). Any other import fails to render.
- Style with Tailwind utility classes (v4 syntax, including arbitrary values like \`w-[38ch]\`). No CSS files, no \`style\` blocks, no config. Dark mode: write \`dark:\` variants — the host sets the class from the user's theme, so both modes must read well.
- TypeScript syntax is allowed and stripped; types are not checked.
- No network of any kind: no fetch, XHR, websockets, external images, fonts, or CDNs. Inline SVG and CSS gradients are your image layer. An https image URL that already appears in this conversation is the one exception.
- No browser storage, no timers left running on unmount, no \`window.parent\` access.
- Inline mode is sized to your content, so do not assume a viewport or set a full-screen height. Panel mode fills a real pane and may scroll.`;

/**
 * The data-binding contract. Only added to the schema description when the
 * user actually has integrations connected — with none, the whole concept is
 * dead weight in the prompt.
 *
 * The first rule is the one that kept being broken: a model that had already
 * called an integration would paste the values it got into the JSX, shipping a
 * dashboard that was a screenshot. Bindings are how the page stays alive, and
 * they cost one line each.
 */
export function buildBindingReference(
  integrations: { name: string; description?: string }[],
): string {
  const list = integrations
    .map(({ name, description }) =>
      description ? `- ${name}: ${description}` : `- ${name}`,
    )
    .join("\n");
  return `Data (live reads from the user's connected integrations):
- If this artifact shows anything that lives in an integration, BIND it. Never paste values you fetched earlier into the code — a pasted number is stale the second time the user opens the page, and they will open it again.
- Declare every read up front in \`bindings\`. Each is { id, integration, tool, args, label }: \`integration\` is an exact name from the list below, \`tool\` is one of its tools, \`args\` is a JSON-encoded arguments object, \`label\` is a short human phrase like "Open issues".
- Run \`mcp_list_tools\` first if you are not certain of a tool's name and schema. Every binding you declare is executed here before the artifact renders, and a binding that fails takes the whole call back with the reason — so a wrong tool name costs you a retry, not the user a broken page.
- Ask for what fits: pass limits, page sizes, and filters in \`args\`. One read carries about 100,000 characters, and a response bigger than that fails the call.
- In the module, read a binding with \`import { useWhirlData } from "@whirl/data"\` then \`const { data, error, loading, refetch } = useWhirlData("<id>")\`. \`data\` is the parsed response (an object or array when the integration returns JSON, otherwise a string). Always render a loading state and an error state; never assume data is present on the first frame.
- Write defensively against the response: optional chaining, \`Array.isArray\` before mapping, a fallback for a missing field. You are writing against a shape you have seen once.
- \`refetch(extraArgs)\` re-runs the binding live with extra arguments merged in — that is how filters and refresh buttons work. Never call it in a bare effect that reruns every render.
- Reads only. Bindings cannot send, create, delete, or modify anything; declare one and the artifact stops being publicly shareable.
- The exception: a single fixed number that will not change is fine written into the code. Anything list-shaped, dated, or countable gets a binding.

Connected integrations:
${list}`;
}

type ParsedBinding = ArtifactBinding & { args?: string };

/**
 * Validate the declared bindings. Rejected outright rather than silently
 * dropped: a page whose data silently vanished renders empty states forever
 * and the model never learns why.
 */
export function validateBindings(
  raw: unknown,
  connectedIntegrations: string[],
): { ok: true; bindings: ParsedBinding[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, bindings: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "`bindings` must be an array." };
  }
  if (raw.length > MAX_BINDINGS) {
    return {
      ok: false,
      error: `Too many bindings (${raw.length}); the limit is ${MAX_BINDINGS}. Combine reads or drop the ones the page can do without.`,
    };
  }

  const known = new Map(
    connectedIntegrations.map((name) => [name.trim().toLowerCase(), name]),
  );
  const seen = new Set<string>();
  const bindings: ParsedBinding[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, error: "Every binding must be an object." };
    }
    const { id, integration, tool: toolName, args, label } = entry as Record<
      string,
      unknown
    >;

    if (typeof id !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(id)) {
      return {
        ok: false,
        error: `Binding id ${JSON.stringify(id)} is invalid. Use a short identifier like "openIssues".`,
      };
    }
    if (seen.has(id)) {
      return { ok: false, error: `Duplicate binding id "${id}".` };
    }
    seen.add(id);

    if (typeof integration !== "string" || !integration.trim()) {
      return { ok: false, error: `Binding "${id}" is missing an integration.` };
    }
    const resolved = known.get(integration.trim().toLowerCase());
    if (!resolved) {
      return {
        ok: false,
        error:
          connectedIntegrations.length > 0
            ? `Binding "${id}" names "${integration}", which is not connected. Connected integrations: ${connectedIntegrations.join(", ")}.`
            : `Binding "${id}" needs an integration, but the user has none connected. Write the artifact without live data.`,
      };
    }

    if (typeof toolName !== "string" || !toolName.trim()) {
      return { ok: false, error: `Binding "${id}" is missing a tool name.` };
    }

    let argsJson: string | undefined;
    if (args !== undefined && args !== null && args !== "") {
      if (typeof args !== "string") {
        return {
          ok: false,
          error: `Binding "${id}" must pass \`args\` as a JSON-encoded string.`,
        };
      }
      if (args.length > MAX_BINDING_ARGS_LENGTH) {
        return { ok: false, error: `Binding "${id}" has oversized args.` };
      }
      try {
        const parsed: unknown = JSON.parse(args);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("not an object");
        }
      } catch {
        return {
          ok: false,
          error: `Binding "${id}" has \`args\` that is not a JSON-encoded object.`,
        };
      }
      argsJson = args;
    }

    bindings.push({
      id,
      integration: resolved,
      tool: toolName.trim(),
      ...(argsJson ? { args: argsJson } : {}),
      ...(typeof label === "string" && label.trim()
        ? { label: label.trim().slice(0, 80) }
        : {}),
    });
  }

  return { ok: true, bindings };
}

/**
 * The tool itself. `bindingsEnabled` decides whether the data half of the
 * contract is offered at all — with no integrations connected, declaring a
 * binding could only ever fail, so the field and its instructions stay out of
 * the request entirely.
 */
export function createReactArtifactTool({
  finalize,
  abort,
  onResult,
  connectedIntegrations,
  readBinding,
  warmBindings,
}: {
  finalize: (args: {
    toolCallId: string;
    title: string;
    code: string;
    mode: "inline" | "full";
    bindings: ParsedBinding[];
  }) => Promise<{ htmlId: Id<"htmlArtifacts"> }>;
  /**
   * Tear down the row and card the stream loop opened on tool-input-start,
   * for a call that never reaches finalize. Without it a rejected artifact
   * leaves a row stuck "streaming" and a card working forever.
   */
  abort: (toolCallId: string) => Promise<void>;
  onResult: (payload: ReactPhasePayload) => Promise<void>;
  /** Name + description of everything the user has connected right now. */
  connectedIntegrations: { name: string; description?: string }[];
  /**
   * Run one declared read here, at authoring time.
   *
   * This is the difference between a dashboard and a hopeful guess. The model
   * writes bindings against a tool schema it may only have skimmed, and until
   * this existed a wrong tool name or a bad argument shipped anyway: the page
   * rendered its error state forever, the model was told "rendered", and the
   * user got a card full of nothing. Now every binding is proven before the
   * artifact is finalized, and a failure is handed back to be fixed.
   */
  readBinding?: (binding: {
    integration: string;
    tool: string;
    args?: string;
  }) => Promise<
    { ok: true; text: string; shape: string } | { ok: false; error: string }
  >;
  /** Seed the proven responses into the artifact's cache for its first paint. */
  warmBindings?: (
    htmlId: Id<"htmlArtifacts">,
    entries: { bindingId: string; args?: string; value: string }[],
  ) => Promise<void>;
}) {
  const bindingsEnabled = connectedIntegrations.length > 0;
  const codeDescription = [
    "The complete JSX module. Put last.",
    REACT_RUNTIME_REFERENCE,
    bindingsEnabled ? buildBindingReference(connectedIntegrations) : "",
    FULL_PAGE_DESIGN_NOTES,
  ]
    .filter(Boolean)
    .join("\n\n");

  return tool({
    description:
      "Build an interactive React + Tailwind artifact — a dashboard, tool, calculator, or data view. Prefer this over HTML whenever the thing has state, and it is the only way to show live data from a connected integration.",
    inputSchema: jsonSchema<{
      title: string;
      mode?: "inline" | "full";
      bindings?: unknown;
      code: string;
    }>({
      type: "object",
      properties: {
        title: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TITLE_LENGTH,
          description: "Short title.",
        },
        mode: {
          type: "string",
          enum: ["inline", "full"],
          description:
            "'inline' renders a compact card in the conversation (default); 'full' opens a full pane in the side panel — use it for dashboards and anything multi-section.",
        },
        ...(bindingsEnabled
          ? {
              bindings: {
                type: "array",
                maxItems: MAX_BINDINGS,
                description:
                  "Live read-only integration reads this artifact needs. Omit entirely if it needs none.",
                items: {
                  type: "object",
                  properties: {
                    id: {
                      type: "string",
                      description:
                        "Identifier the component passes to useWhirlData.",
                    },
                    integration: {
                      type: "string",
                      description: "Exact connected integration name.",
                    },
                    tool: {
                      type: "string",
                      description: "Tool on that integration to run.",
                    },
                    args: {
                      type: "string",
                      description: "JSON-encoded arguments object.",
                    },
                    label: {
                      type: "string",
                      description: "Short human label, e.g. 'Open issues'.",
                    },
                  },
                  required: ["id", "integration", "tool"],
                  additionalProperties: false,
                },
              },
            }
          : {}),
        code: {
          type: "string",
          minLength: 1,
          maxLength: MAX_CODE_LENGTH,
          description: codeDescription,
        },
      },
      required: ["title", "code"],
      additionalProperties: false,
    }),
    execute: async ({ title, mode, bindings, code }, { toolCallId }) => {
      const validated = validateBindings(
        bindings,
        connectedIntegrations.map((i) => i.name),
      );
      if (!validated.ok) {
        await abort(toolCallId);
        return {
          ok: false,
          error: validated.error,
          note: "Nothing was rendered. Fix the bindings and call createReactArtifact again.",
        };
      }

      /* Prove every declared read before anything is rendered. All at once —
         they're independent, and a dashboard with five sources shouldn't take
         five round trips to find out the second one is misspelled. */
      const proven: {
        bindingId: string;
        args?: string;
        value: string;
        shape: string;
      }[] = [];
      if (readBinding && validated.bindings.length > 0) {
        const reads = await Promise.all(
          validated.bindings.map(async (binding) => ({
            binding,
            result: await readBinding({
              integration: binding.integration,
              tool: binding.tool,
              ...(binding.args ? { args: binding.args } : {}),
            }),
          })),
        );

        const failures = reads.flatMap(({ binding, result }) =>
          result.ok ? [] : [{ binding, error: result.error }],
        );
        if (failures.length > 0) {
          await abort(toolCallId);
          return {
            ok: false,
            error: failures
              .map(
                ({ binding, error }) =>
                  `Binding "${binding.id}" (${binding.integration} · ${binding.tool}) couldn't be read: ${error}`,
              )
              .join("\n"),
            note: "Nothing was rendered. Run `mcp_list_tools` on that integration to check the tool's exact name and argument schema, then call createReactArtifact again. If a source genuinely can't be read, drop that binding and build the artifact without it rather than retrying it forever.",
          };
        }

        for (const { binding, result } of reads) {
          if (!result.ok) continue;
          proven.push({
            bindingId: binding.id,
            ...(binding.args ? { args: binding.args } : {}),
            value: result.text,
            shape: result.shape,
          });
        }
      }

      const cleanTitle = title.trim().slice(0, MAX_TITLE_LENGTH) || "Untitled";
      const resolvedMode = mode === "full" ? "full" : "inline";
      const { htmlId } = await finalize({
        toolCallId,
        title: cleanTitle,
        code,
        mode: resolvedMode,
        bindings: validated.bindings,
      });

      // Hand the artifact the responses we already have, so a page with live
      // data opens showing it instead of opening on a row of spinners.
      if (warmBindings && proven.length > 0) {
        await warmBindings(
          htmlId,
          proven.map(({ bindingId, args, value }) => ({
            bindingId,
            ...(args ? { args } : {}),
            value,
          })),
        );
      }

      await onResult({
        op: "create",
        mode: resolvedMode,
        htmlId,
        title: cleanTitle,
        bindingCount: validated.bindings.length,
      });

      return {
        htmlId,
        ok: true,
        // The shapes go back deliberately: an editHtml pass later needs to know
        // what each binding actually returns, and this is the only place that
        // ever saw it.
        ...(proven.length > 0
          ? {
              dataSources: proven.map(({ bindingId, shape }) => ({
                binding: bindingId,
                returns: shape,
              })),
            }
          : {}),
        note: [
          resolvedMode === "full"
            ? "Rendered and opened in the side panel for the user."
            : "Rendered inline in the conversation for the user.",
          validated.bindings.length > 0
            ? "Every binding was read successfully and the artifact refreshes itself from them, so its numbers will move on without you — describe what it shows, never the specific values. It is not publicly shareable."
            : "",
          "Revise it later with editHtml using this id.",
        ]
          .filter(Boolean)
          .join(" "),
      };
    },
  });
}
