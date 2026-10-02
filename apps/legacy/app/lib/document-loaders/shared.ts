const MAX_CHARS = 200_000;

export function clampDocumentText(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return `${text.slice(0, MAX_CHARS)}\n\n...[truncated - document was too long to include in full]`;
}
