import { clampDocumentText } from "./shared";
import type { DocumentExtraction, DocumentLoader } from "./types";

export class DocxLoader implements DocumentLoader {
  async load(file: File): Promise<DocumentExtraction> {
    const mammoth = (await import("mammoth/mammoth.browser.js")).default;
    const arrayBuffer = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    const text = value.trim();

    if (!text) {
      return { kind: "skipped", reason: "This document appears to be empty." };
    }

    return { kind: "text", text: clampDocumentText(text) };
  }
}
