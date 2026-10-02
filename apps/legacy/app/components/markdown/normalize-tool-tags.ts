// Some models — especially when OpenRouter's Auto routes to a model without
// native tool-calling, or when MCP tools are attached — emit a tool call as raw
// Anthropic-style XML in their TEXT stream instead of as a structured tool-call
// event. That protocol XML (`<function_calls>`, `<invoke>`, `<parameter>`,
// sometimes carrying the `antml:` namespace prefix) is never meant for the
// reader, but it lands verbatim in the message content and renders as broken
// markup. Strip it so the chat shows only the prose around it.

// Code regions (fenced blocks + inline spans) are left untouched: a model that
// is legitimately *explaining* the tool-call format inside a code block should
// still show it. Mirrors normalize-math's CODE_REGION guard.
const CODE_REGION = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;

// Complete blocks. Bodies are non-greedy so back-to-back invocations each match
// on their own; `i` makes the tag names case-insensitive; the optional
// `antml:` prefix covers models that echo the namespaced form.
const FUNCTION_CALLS =
  /<(?:antml:)?function_calls\b[^>]*>[\s\S]*?<\/(?:antml:)?function_calls>/gi;
const INVOKE = /<(?:antml:)?invoke\b[^>]*>[\s\S]*?<\/(?:antml:)?invoke>/gi;
const PARAMETER =
  /<(?:antml:)?parameter\b[^>]*>[\s\S]*?<\/(?:antml:)?parameter>/gi;

// Mid-stream: an opener whose closing tag hasn't arrived yet. Cut from it to the
// end so a half-written tag never flashes on screen. Only applied to the final
// prose segment (see below) so a stray `<` earlier in the message is safe. A
// lone `<parameter` only exists inside an `<invoke>` we'd already have cut, so
// it isn't listed here.
const OPEN_TAIL = /<(?:antml:)?(?:function_calls|invoke)\b[\s\S]*$/i;

/**
 * Remove leaked tool-invocation XML (`<function_calls>` / `<invoke>` /
 * `<parameter>`) from assistant text, both complete blocks and a still-streaming
 * trailing opener. Code blocks and inline code are preserved untouched.
 */
export function stripToolInvocations(content: string): string {
  // Fast path: no angle bracket means nothing to strip.
  if (!content.includes("<")) return content;

  const parts = content.split(CODE_REGION);
  const lastIndex = parts.length - 1;
  return parts
    .map((segment, index) => {
      // Odd indices are the captured code regions — never rewrite them.
      if (index % 2 !== 0) return segment;
      let prose = segment
        .replace(FUNCTION_CALLS, "")
        .replace(INVOKE, "")
        .replace(PARAMETER, "");
      // Only the last prose segment can hold a genuinely mid-stream opener.
      if (index === lastIndex) prose = prose.replace(OPEN_TAIL, "");
      return prose;
    })
    .join("");
}
