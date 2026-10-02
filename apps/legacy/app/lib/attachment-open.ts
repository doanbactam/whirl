/**
 * Shared logic for "what happens when you click an attachment". Images zoom in
 * the lightbox, text/markdown open the (editable) text viewer, and everything
 * else gets popped into a new browser tab.
 */

export type AttachmentKind = "image" | "text" | "file";

/** Plain-text-ish files we can show (and edit) in the text viewer. */
const TEXT_EXTENSIONS = new Set([
  "c",
  "conf",
  "cpp",
  "cs",
  "csv",
  "h",
  "css",
  "dart",
  "diff",
  "env",
  "go",
  "scss",
  "html",
  "htm",
  "ini",
  "java",
  "js",
  "json",
  "jsonc",
  "jsx",
  "kt",
  "kts",
  "log",
  "lua",
  "markdown",
  "md",
  "mdx",
  "patch",
  "php",
  "py",
  "r",
  "rb",
  "rs",
  "scala",
  "sh",
  "sql",
  "srt",
  "svelte",
  "swift",
  "text",
  "toml",
  "ts",
  "tsx",
  "tsv",
  "txt",
  "vue",
  "vtt",
  "xml",
  "yaml",
  "yml",
]);

function extensionOf(name: string): string {
  return name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? "") : "";
}

/** True when the file is text/markdown we can render in the text viewer. */
export function isTextLikeAttachment(name: string, type: string): boolean {
  const t = type.toLowerCase();
  if (t.startsWith("image/")) return false;
  if (t.startsWith("text/") || t === "application/json") return true;
  return TEXT_EXTENSIONS.has(extensionOf(name));
}

/** True for markdown files, which open in the rich document sidebar. */
export function isMarkdownAttachment(name: string, type: string): boolean {
  const t = type.toLowerCase();
  if (t === "text/markdown" || t === "text/x-markdown") return true;
  return ["md", "markdown", "mdx"].includes(extensionOf(name));
}

/** Bucket an attachment by how clicking it should behave. */
export function attachmentKind(
  name: string,
  type: string,
  hasExtractedText = false,
): AttachmentKind {
  if (type.toLowerCase().startsWith("image/")) return "image";
  if (hasExtractedText) return "text";
  if (isTextLikeAttachment(name, type)) return "text";
  return "file";
}

/** Open a URL in a fresh tab without leaking the opener reference. */
export function openInNewTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}
