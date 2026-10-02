import { useState } from "react";
import { IconCheck, IconDownload } from "@tabler/icons-react";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

const LANG_EXTENSIONS: Record<string, string> = {
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  python: "py",
  py: "py",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  zsh: "sh",
  json: "json",
  html: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  rust: "rs",
  rs: "rs",
  go: "go",
  golang: "go",
  java: "java",
  kotlin: "kt",
  kt: "kt",
  swift: "swift",
  ruby: "rb",
  rb: "rb",
  php: "php",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "cs",
  cs: "cs",
  yaml: "yml",
  yml: "yml",
  markdown: "md",
  md: "md",
  xml: "xml",
  dockerfile: "dockerfile",
  docker: "dockerfile",
  toml: "toml",
  lua: "lua",
  r: "r",
  perl: "pl",
  pl: "pl",
  scala: "scala",
  dart: "dart",
  vue: "vue",
  svelte: "svelte",
  text: "txt",
  plaintext: "txt",
};

function extensionForLanguage(language: string): string {
  const normalized = language.toLowerCase().trim();
  if (!normalized || normalized === "code") return "txt";
  return LANG_EXTENSIONS[normalized] ?? "txt";
}

function filenameForLanguage(language: string): string {
  return `snippet.${extensionForLanguage(language)}`;
}

/**
 * tiny download button shared by code blocks — saves raw source as a file.
 */
export function DownloadButton({
  getText,
  language,
  className,
  label = true,
}: {
  getText: () => string;
  language: string;
  className?: string;
  label?: boolean;
}) {
  const capture = useCapture();
  const [downloaded, setDownloaded] = useState(false);
  const Glyph = downloaded ? IconCheck : IconDownload;

  const handleDownload = () => {
    try {
      const content = getText();
      const filename = filenameForLanguage(language);
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      capture(ANALYTICS_EVENTS.codeBlockDownloaded, {
        language: language || "unknown",
        extension: extensionForLanguage(language),
        byte_length: content.length,
      });
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 1500);
    } catch {}
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      aria-label={downloaded ? "Downloaded" : "Download"}
      className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-black/[0.06] hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-white/[0.08] dark:hover:text-neutral-200 ${className ?? ""}`}
    >
      <Glyph size={12} stroke={2} />
      {label && (downloaded ? "saved" : "download")}
    </button>
  );
}
