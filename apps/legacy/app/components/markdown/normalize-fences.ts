// Languages that mean "this fence is actually prose/markup", not code. When a
// model wraps its WHOLE reply in one of these, the fence is a mistake — the
// content was meant to render, not to be shown as raw source.
const PROSE_FENCE_LANGS = new Set([
  "markdown",
  "md",
  "mdx",
  "text",
  "txt",
  "plaintext",
]);

// A fence that opens at the very start and closes at the very end of the
// (trimmed) message — i.e. it wraps everything. Non-greedy body + an end
// anchor with no `m` flag means \1 only matches the final closing fence, so
// inner code blocks inside the wrapper are left as content.
const FULL_WRAP = /^(`{3,})([^\n`]*)\r?\n([\s\S]*?)\r?\n?\1[ \t]*$/;

// Opening fence with no closing one yet — the streaming case, where we still
// want the body to render live instead of as a growing code block.
const OPEN_WRAP = /^(`{3,})([^\n`]*)\r?\n([\s\S]*)$/;

// Signals that a bare (untagged) fence body was meant to render as markdown
// rather than being literal code. Used only for `​```` with no language; a
// fence tagged with a real language (js, python, …) is always left alone.
function looksLikeMarkdownProse(body: string): boolean {
  return (
    /^#{1,6}\s/m.test(body) || // headings
    /\*\*[^*\n]+\*\*/.test(body) || // bold
    /^\s*[-*+]\s+\S/m.test(body) || // bullet list
    /^\s*\d+\.\s+\S/m.test(body) || // numbered list
    /\[[^\]\n]+\]\([^)\n]+\)/.test(body) || // links
    /^\s*\|.*\|/m.test(body) || // table row
    /^\s*>\s/m.test(body) // blockquote
  );
}

function shouldUnwrap(lang: string, body: string): boolean {
  const normalized = lang.trim().toLowerCase();
  if (PROSE_FENCE_LANGS.has(normalized)) return true;
  return normalized === "" && looksLikeMarkdownProse(body);
}

/**
 * Models sometimes wrap an entire answer in a ```markdown (or bare ```) fence,
 * which makes the whole reply render as a monospace code block, and — when the
 * wrapper collides with inner code blocks or a stream cuts it off — leaks stray
 * ``` into the text. When the full message is one such prose-ish wrapper, strip
 * it so the content renders as the markdown it always was. Real code blocks
 * (```ts, ```python, …) are never touched.
 */
export function unwrapWholeMessageFence(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) return content;

  const closed = FULL_WRAP.exec(trimmed);
  if (closed && shouldUnwrap(closed[2], closed[3])) {
    return closed[3];
  }

  // Mid-stream: the opening fence has arrived but the closing one hasn't.
  // Unwrap progressively so a wrapped reply renders as it streams in.
  if (!closed) {
    const open = OPEN_WRAP.exec(trimmed);
    if (open && shouldUnwrap(open[2], open[3])) {
      return open[3];
    }
  }

  return content;
}
