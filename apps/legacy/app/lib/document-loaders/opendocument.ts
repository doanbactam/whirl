import { loadZip, zipText } from "./archive";
import { clampDocumentText } from "./shared";
import type { DocumentExtraction, DocumentLoader } from "./types";
import {
  attr,
  childElements,
  childrenByLocalName,
  cleanText,
  descendantElements,
  descendantsByLocalName,
  localNameOf,
  parseXml,
} from "./xml";

function extensionOf(name: string): string {
  return name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? "") : "";
}

function textDocumentContent(xml: string): string {
  const doc = parseXml(xml);
  return descendantElements(doc)
    .filter((node) => ["p", "h"].includes(localNameOf(node)))
    .map((node) => cleanText(node.textContent ?? ""))
    .filter(Boolean)
    .join("\n");
}

function repeatedCount(element: Element, name: string): number {
  const raw = attr(element, name);
  const parsed = raw ? Number(raw) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function spreadsheetContent(xml: string): string {
  const doc = parseXml(xml);
  const sections: string[] = [];

  for (const table of descendantsByLocalName(doc, "table")) {
    const name = attr(table, "table:name", "name") ?? "Sheet";
    const lines: string[] = [];

    for (const row of childrenByLocalName(table, "table-row")) {
      const rowRepeat = Math.min(
        repeatedCount(row, "table:number-rows-repeated"),
        20,
      );
      const values: string[] = [];

      const cells = childElements(row).filter((child) =>
        ["table-cell", "covered-table-cell"].includes(localNameOf(child)),
      );
      for (const cell of cells) {
        const value = cleanText(cell.textContent ?? "");
        const repeat = value
          ? Math.min(repeatedCount(cell, "table:number-columns-repeated"), 20)
          : 1;
        for (let i = 0; i < repeat; i += 1) values.push(value);
      }

      while (values.length > 0 && !values[values.length - 1]) values.pop();
      if (!values.some(Boolean)) continue;

      const line = values.join("\t");
      for (let i = 0; i < rowRepeat; i += 1) lines.push(line);
    }

    if (lines.length > 0) sections.push(`Sheet: ${name}\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
}

export class OpenDocumentLoader implements DocumentLoader {
  async load(file: File): Promise<DocumentExtraction> {
    const zip = await loadZip(file);
    const xml = await zipText(zip, "content.xml");
    if (!xml) {
      return {
        kind: "skipped",
        reason: "This OpenDocument file does not contain readable content.",
      };
    }

    const ext = extensionOf(file.name);
    const text = (
      ext === "ods" ? spreadsheetContent(xml) : textDocumentContent(xml)
    ).trim();
    if (!text) {
      return {
        kind: "skipped",
        reason: "This OpenDocument file appears to be empty.",
      };
    }

    return { kind: "text", text: clampDocumentText(text) };
  }
}
