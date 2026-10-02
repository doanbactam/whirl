import {
  isValidElement,
  useMemo,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Streamdown } from "streamdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";

import { CodeBlock } from "~/components/markdown/code-block";
import { MarkdownImage } from "~/components/markdown/markdown-image";
import { MarkdownTable } from "~/components/markdown/markdown-table";
import { MermaidDiagram } from "~/components/markdown/mermaid-diagram";
import { normalizeMathDelimiters } from "~/components/markdown/normalize-math";
import { unwrapWholeMessageFence } from "~/components/markdown/normalize-fences";
import { stripToolInvocations } from "~/components/markdown/normalize-tool-tags";

/** Flatten a React node tree back to plain text — used to recover a code block's
 *  raw source when the renderer hands us element children instead of a string. */
function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeText(node.props.children);
  }
  return "";
}

/** Shared `<code>` renderer. Streamdown funnels BOTH inline and fenced code
 *  through the `inlineCode` slot, so we tell them apart by the `language-*`
 *  class (present only on fenced blocks), not by which slot fired. */
function renderCodeNode(
  { className, children, ...props }: { className?: string; children?: ReactNode },
  inverted: boolean,
  codeBg: string,
): ReactNode {
  const isBlock = className?.startsWith("language-");
  if (isBlock && !inverted) {
    const lang = className!.replace("language-", "");
    // Mermaid fences become live diagram cards, same family as inline
    // visualizations; every other language keeps the highlighted code block.
    if (lang === "mermaid") {
      return <MermaidDiagram code={nodeText(children).replace(/\n$/, "")} />;
    }
    return (
      <CodeBlock code={nodeText(children).replace(/\n$/, "")} language={lang} />
    );
  }
  if (isBlock) {
    return (
      <code className={`font-mono text-[13px] ${className ?? ""}`} {...props}>
        {children}
      </code>
    );
  }
  return (
    <code
      className={`rounded px-1 py-0.5 font-mono text-[13px] ${codeBg}`}
      {...props}
    >
      {children}
    </code>
  );
}

// These MUST keep a stable identity across renders. Streamdown memoizes settled
// paragraph blocks so they never re-render (and never re-fire their fade) as the
// reply streams — but its block-memo comparator bails the moment the plugin
// arrays change identity. Passing fresh literals every render defeated it, so
// every already-shown paragraph re-animated on each token. Local dev's char-by-
// char trickle smeared that into a continuous shimmer that read as smooth; prod's
// paragraph-sized chunks made each re-fade a visible, jarring replay. Hoisting
// them out of render is the fix. `remark-gfm` is included explicitly because
// Streamdown only auto-adds it when no remarkPlugins are passed; `$` stays
// literal (prices) — only `$$…$$` typesets as math.
const REMARK_PLUGINS: ComponentProps<typeof Streamdown>["remarkPlugins"] = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
];
const REHYPE_PLUGINS: ComponentProps<typeof Streamdown>["rehypePlugins"] = [
  rehypeKatex,
];
// Enabling `animated` is what makes Streamdown wrap each streamed character in
// its own `[data-sd-animate]` span — `sep: "char"` is the load-bearing part here.
// We do NOT rely on Streamdown's duration/stagger: its plugin decides which chars
// are "new" via shared state mutated during render, which desyncs under React's
// prod renderer and stamps everything with duration:0 (no fade). Instead the fade
// is pinned in CSS on `[data-sd-animate]` (see app.css), where it fires per span
// on mount — so duration/stagger here are inert, kept only to satisfy the type.
const STREAM_ANIMATION = {
  animation: "blurIn",
  sep: "char",
  duration: 320,
  stagger: 0,
} as const;

/**
 * The app's markdown renderer for chat content. Shared between the live message
 * bubble and the public shared-thread page so both render code, tables, links,
 * and math identically. `inverted` flips colors for dark/glass surfaces;
 * `streaming` turns on Streamdown's per-character mount fade.
 */
export function Markdown({
  content,
  inverted,
  streaming,
}: {
  content: string;
  inverted: boolean;
  streaming: boolean;
}) {
  // Clean the raw model text in layers: first drop any leaked tool-invocation
  // XML (<invoke>/<parameter> blocks a model emitted as text instead of a real
  // tool call), then peel off any ```markdown/``` wrapper around the whole reply
  // (renders as a code block / leaks stray fences otherwise), then fix up stray
  // \(...\)/\[...\] math delimiters outside code so they still typeset.
  const normalized = useMemo(
    () =>
      normalizeMathDelimiters(
        unwrapWholeMessageFence(stripToolInvocations(content)),
      ),
    [content],
  );
  const linkColor = inverted
    ? "text-white underline underline-offset-2 decoration-white/60 hover:decoration-white"
    : "text-[#0c82f2] underline underline-offset-2 decoration-[#0c82f2]/40 hover:decoration-[#0c82f2]";
  const codeBg = inverted
    ? "bg-white/15 text-white"
    : "bg-black/[0.06] text-neutral-800 dark:bg-white/[0.08] dark:text-neutral-100";
  const preBg = inverted
    ? "bg-black/20 text-white"
    : "bg-black/[0.04] text-neutral-800 dark:bg-white/[0.05] dark:text-neutral-100";
  const borderColor = inverted
    ? "border-white/20"
    : "border-black/10 dark:border-white/10";

  const components = useMemo(() => ({
    p: ({ children }: { children?: ReactNode }) => (
      <p className="whitespace-pre-wrap [&:not(:last-child)]:mb-3.5">
        {children}
      </p>
    ),
    a: ({ children, href }: { children?: ReactNode; href?: string }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className={linkColor}>
        {children}
      </a>
    ),
    img: ({ src, alt }: { src?: string; alt?: string }) => (
      <MarkdownImage src={src} alt={alt} />
    ),
    ul: ({ children }: { children?: ReactNode }) => (
      <ul className="my-1 ml-5 list-disc [&>li]:mt-0.5 [&_li>p]:mb-0! [&_li>p:not(:last-child)]:mb-1!">
        {children}
      </ul>
    ),
    ol: ({ children }: { children?: ReactNode }) => (
      <ol className="my-1 ml-5 list-decimal [&>li]:mt-0.5 [&_li>p]:mb-0! [&_li>p:not(:last-child)]:mb-1!">
        {children}
      </ol>
    ),
    li: ({ children }: { children?: ReactNode }) => <li>{children}</li>,
    strong: ({ children }: { children?: ReactNode }) => (
      <strong>{children}</strong>
    ),
    em: ({ children }: { children?: ReactNode }) => (
      <em>{children}</em>
    ),
    del: ({ children }: { children?: ReactNode }) => (
      <del>{children}</del>
    ),
    h1: ({ children }: { children?: ReactNode }) => (
      <h1 className="mt-5 mb-2 text-[24px] font-semibold leading-8 tracking-[-0.01em] first:mt-0">
        {children}
      </h1>
    ),
    h2: ({ children }: { children?: ReactNode }) => (
      <h2 className="mt-5 mb-2 text-[21px] font-semibold leading-7 tracking-[-0.01em] first:mt-0">
        {children}
      </h2>
    ),
    h3: ({ children }: { children?: ReactNode }) => (
      <h3 className="mt-4 mb-1.5 text-[18px] font-semibold leading-6 first:mt-0">
        {children}
      </h3>
    ),
    h4: ({ children }: { children?: ReactNode }) => (
      <h4 className="mt-4 mb-1.5 text-[16px] font-semibold leading-6 first:mt-0">
        {children}
      </h4>
    ),
    h5: ({ children }: { children?: ReactNode }) => (
      <h5 className="mt-3 mb-1 text-[14px] font-semibold uppercase tracking-wide first:mt-0">
        {children}
      </h5>
    ),
    h6: ({ children }: { children?: ReactNode }) => (
      <h6 className="mt-3 mb-1 text-[13px] font-semibold uppercase tracking-wide opacity-80 first:mt-0">
        {children}
      </h6>
    ),
    blockquote: ({ children }: { children?: ReactNode }) => (
      <blockquote className={`my-1 border-l-2 ${borderColor} pl-3 italic opacity-90`}>
        {children}
      </blockquote>
    ),
    code: (props: { className?: string; children?: ReactNode }) =>
      renderCodeNode(props, inverted, codeBg),
    inlineCode: (props: { className?: string; children?: ReactNode }) =>
      renderCodeNode(props, inverted, codeBg),
    pre: ({ children }: { children?: ReactNode }) => {
      // block code (non-inverted) renders its own carded CodeBlock — don't
      // wrap it in a second box. detect via the child <code>'s language-*
      // class rather than component identity (which react-markdown rewrites).
      const childClass =
        isValidElement<{ className?: string }>(children) &&
        children.props.className;
      const isHighlighted =
        typeof childClass === "string" &&
        childClass.startsWith("language-") &&
        !inverted;
      if (isHighlighted) {
        return <>{children}</>;
      }
      return (
        <pre
          className={`my-2 overflow-x-auto rounded-lg p-3 font-mono text-[13px] leading-5 ${preBg}`}
        >
          {children}
        </pre>
      );
    },
    hr: () => <hr className={`my-3 border-t ${borderColor}`} />,
    table: ({ children }: { children?: ReactNode }) => (
      <MarkdownTable inverted={inverted}>{children}</MarkdownTable>
    ),
  }), [linkColor, codeBg, preBg, borderColor, inverted]);

  return (
    <Streamdown
      // App's base type scale; `space-y-0` cancels Streamdown's default
      // inter-block spacing so our own per-element margins stay authoritative.
      className="text-[16px] leading-[1.7] space-y-0"
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      // We render our own copy/table chrome, so suppress Streamdown's controls.
      controls={false}
      parseIncompleteMarkdown
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      animated={streaming ? STREAM_ANIMATION : false}
      components={components}
    >
      {normalized}
    </Streamdown>
  );
}
