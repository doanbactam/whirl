import { useEffect, useState } from "react";
import { CopyButton } from "./copy-button";
import { DownloadButton } from "./download-button";

/**
 * a clean, carded code block: language label + download/copy in a soft header bar,
 * shiki-highlighted body below. background is transparent so the card tint
 * shows through (works in both light + dark).
 */
export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const lang = language || "code";

  useEffect(() => {
    let cancelled = false;
    import("shiki/bundle/web")
      .then(({ codeToHtml }) =>
        codeToHtml(code, {
          lang: language || "text",
          themes: {
            light: "github-light",
            dark: "github-dark-default",
          },
        }),
      )
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return (
    <div className="group/code my-3 overflow-hidden rounded-xl border border-black/[0.08] dark:border-white/[0.08]">
      <div className="flex items-center justify-between border-b border-black/[0.07] bg-black/[0.03] px-3 py-1 dark:border-white/[0.07] dark:bg-white/[0.04]">
        <span className="select-none font-mono text-[11px] font-medium lowercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {lang}
        </span>
        <div className="flex items-center gap-0.5">
          <DownloadButton getText={() => code} language={lang} />
          <CopyButton getText={() => code} />
        </div>
      </div>
      <div className="table-scroll overflow-x-auto">
        {html ? (
          <div
            dangerouslySetInnerHTML={{ __html: html }}
            className="shiki-wrap [&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:px-3.5 [&_pre]:py-3 [&_pre]:font-mono [&_pre]:text-[12.5px] [&_pre]:leading-[1.6]"
          />
        ) : (
          <pre className="bg-transparent px-3.5 py-3 font-mono text-[12.5px] leading-[1.6] text-neutral-800 dark:text-neutral-200">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
