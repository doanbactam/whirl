import { loadZip, resolvePackagePath, zipText } from "./archive";
import { clampDocumentText } from "./shared";
import type { DocumentExtraction, DocumentLoader } from "./types";
import {
  attr,
  childrenByLocalName,
  cleanText,
  descendantsByLocalName,
  firstDescendantText,
  parseXml,
} from "./xml";

type Relationship = {
  id: string;
  type: string;
  target: string;
};

type SheetInfo = {
  name: string;
  path: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BUILTIN_DATE_FORMAT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

async function relationshipsFor(
  zip: Awaited<ReturnType<typeof loadZip>>,
  sourcePath: string,
): Promise<Map<string, Relationship>> {
  const slash = sourcePath.lastIndexOf("/");
  const dir = slash >= 0 ? sourcePath.slice(0, slash + 1) : "";
  const name = slash >= 0 ? sourcePath.slice(slash + 1) : sourcePath;
  const relsPath = `${dir}_rels/${name}.rels`;
  const xml = await zipText(zip, relsPath);
  if (!xml) return new Map();

  const doc = parseXml(xml);
  const relationships = new Map<string, Relationship>();
  for (const element of descendantsByLocalName(doc, "Relationship")) {
    const id = attr(element, "Id");
    const type = attr(element, "Type") ?? "";
    const target = attr(element, "Target");
    if (!id || !target) continue;
    relationships.set(id, {
      id,
      type,
      target: resolvePackagePath(sourcePath, target),
    });
  }
  return relationships;
}

function fallbackFiles(
  zip: Awaited<ReturnType<typeof loadZip>>,
  prefix: string,
  pattern: RegExp,
) {
  return Object.keys(zip.files)
    .filter((path) => path.startsWith(prefix) && pattern.test(path))
    .sort((a, b) => {
      const aNum = Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0);
      const bNum = Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0);
      return aNum - bNum || a.localeCompare(b);
    });
}

function paragraphText(xml: string): string {
  const doc = parseXml(xml);
  const paragraphs = descendantsByLocalName(doc, "p")
    .map((paragraph) =>
      descendantsByLocalName(paragraph, "t")
        .map((textRun) => textRun.textContent ?? "")
        .join(""),
    )
    .map(cleanText)
    .filter(Boolean);

  return paragraphs.join("\n");
}

function chartText(xml: string): string {
  const doc = parseXml(xml);
  const values = [
    ...descendantsByLocalName(doc, "t"),
    ...descendantsByLocalName(doc, "v"),
  ]
    .map((node) => cleanText(node.textContent ?? ""))
    .filter(Boolean);
  return Array.from(new Set(values)).join("\n");
}

async function presentationSlidePaths(
  zip: Awaited<ReturnType<typeof loadZip>>,
): Promise<string[]> {
  const presentationXml = await zipText(zip, "ppt/presentation.xml");
  if (!presentationXml) {
    return fallbackFiles(zip, "ppt/slides/", /^ppt\/slides\/slide\d+\.xml$/);
  }

  const relationships = await relationshipsFor(zip, "ppt/presentation.xml");
  const doc = parseXml(presentationXml);
  const paths = descendantsByLocalName(doc, "sldId")
    .map((slide) => attr(slide, "r:id", "id"))
    .map((id) => (id ? relationships.get(id)?.target : null))
    .filter((path): path is string => Boolean(path));

  return paths.length > 0
    ? paths
    : fallbackFiles(zip, "ppt/slides/", /^ppt\/slides\/slide\d+\.xml$/);
}

export class PptxLoader implements DocumentLoader {
  async load(file: File): Promise<DocumentExtraction> {
    const zip = await loadZip(file);
    const slidePaths = await presentationSlidePaths(zip);
    const slides: string[] = [];

    for (let index = 0; index < slidePaths.length; index += 1) {
      const path = slidePaths[index];
      const xml = await zipText(zip, path);
      if (!xml) continue;

      const pieces: string[] = [];
      const body = paragraphText(xml);
      if (body) pieces.push(body);

      const relationships = await relationshipsFor(zip, path);
      for (const rel of relationships.values()) {
        if (rel.type.includes("/notesSlide")) {
          const notesXml = await zipText(zip, rel.target);
          const notes = notesXml ? paragraphText(notesXml) : "";
          if (notes) pieces.push(`Notes:\n${notes}`);
        } else if (rel.type.includes("/chart")) {
          const relatedChartXml = await zipText(zip, rel.target);
          const relatedChart = relatedChartXml ? chartText(relatedChartXml) : "";
          if (relatedChart) pieces.push(`Chart:\n${relatedChart}`);
        }
      }

      if (pieces.length > 0) {
        slides.push(`Slide ${index + 1}\n${pieces.join("\n\n")}`);
      }
    }

    const text = slides.join("\n\n").trim();
    if (!text) {
      return {
        kind: "skipped",
        reason: "This presentation does not contain readable text.",
      };
    }

    return { kind: "text", text: clampDocumentText(text) };
  }
}

async function sharedStrings(
  zip: Awaited<ReturnType<typeof loadZip>>,
): Promise<string[]> {
  const xml = await zipText(zip, "xl/sharedStrings.xml");
  if (!xml) return [];

  const doc = parseXml(xml);
  return descendantsByLocalName(doc, "si").map((item) =>
    descendantsByLocalName(item, "t")
      .map((textRun) => textRun.textContent ?? "")
      .join(""),
  );
}

async function workbookInfo(
  zip: Awaited<ReturnType<typeof loadZip>>,
): Promise<{ sheets: SheetInfo[]; date1904: boolean }> {
  const workbookXml = await zipText(zip, "xl/workbook.xml");
  if (!workbookXml) {
    return {
      date1904: false,
      sheets: fallbackFiles(
        zip,
        "xl/worksheets/",
        /^xl\/worksheets\/sheet\d+\.xml$/,
      ).map((path, index) => ({ name: `Sheet ${index + 1}`, path })),
    };
  }

  const relationships = await relationshipsFor(zip, "xl/workbook.xml");
  const doc = parseXml(workbookXml);
  const workbookPr = descendantsByLocalName(doc, "workbookPr")[0];
  const date1904 = ["1", "true"].includes(
    (workbookPr ? attr(workbookPr, "date1904") : null)?.toLowerCase() ?? "",
  );

  const sheets = descendantsByLocalName(doc, "sheet")
    .map((sheet, index) => {
      const name = attr(sheet, "name") ?? `Sheet ${index + 1}`;
      const relationshipId = attr(sheet, "r:id", "id");
      const path = relationshipId
        ? relationships.get(relationshipId)?.target
        : null;
      return path ? { name, path } : null;
    })
    .filter((sheet): sheet is SheetInfo => Boolean(sheet));

  return { date1904, sheets };
}

async function dateStyleIndexes(
  zip: Awaited<ReturnType<typeof loadZip>>,
): Promise<Set<number>> {
  const xml = await zipText(zip, "xl/styles.xml");
  if (!xml) return new Set();

  const doc = parseXml(xml);
  const customFormats = new Map<number, string>();
  for (const format of descendantsByLocalName(doc, "numFmt")) {
    const id = Number(attr(format, "numFmtId"));
    const code = attr(format, "formatCode");
    if (Number.isFinite(id) && code) customFormats.set(id, code);
  }

  const cellXfs = descendantsByLocalName(doc, "cellXfs")[0];
  if (!cellXfs) return new Set();

  const dateStyles = new Set<number>();
  childrenByLocalName(cellXfs, "xf").forEach((xf, index) => {
    const id = Number(attr(xf, "numFmtId"));
    const code = customFormats.get(id);
    if (isDateFormat(id, code)) dateStyles.add(index);
  });
  return dateStyles;
}

function isDateFormat(id: number, code: string | undefined): boolean {
  if (BUILTIN_DATE_FORMAT_IDS.has(id)) return true;
  if (!code) return false;

  const normalized = code
    .replace(/\[[^\]]*]/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .toLowerCase();
  return /[ymdhHs]/.test(normalized) && !/general|0\.00|0%/.test(normalized);
}

function formatExcelDate(raw: string, date1904: boolean): string {
  const serial = Number(raw);
  if (!Number.isFinite(serial)) return raw;

  const epochOffset = date1904 ? 24107 : 25569;
  const date = new Date(Math.round((serial - epochOffset) * MS_PER_DAY));
  if (Number.isNaN(date.getTime())) return raw;

  const iso = date.toISOString();
  return Math.abs(serial - Math.round(serial)) < 0.000001
    ? iso.slice(0, 10)
    : iso.replace(".000Z", "Z");
}

function columnIndex(reference: string): number | null {
  const letters = reference.match(/^[A-Za-z]+/)?.[0];
  if (!letters) return null;

  let out = 0;
  for (const letter of letters.toUpperCase()) {
    out = out * 26 + (letter.charCodeAt(0) - 64);
  }
  return out - 1;
}

function cellValue(
  cell: Element,
  strings: string[],
  dateStyles: Set<number>,
  date1904: boolean,
): string {
  const type = attr(cell, "t");
  const rawValue = firstDescendantText(cell, "v");
  const formula = firstDescendantText(cell, "f");
  const style = Number(attr(cell, "s"));

  let value = "";
  if (type === "s") {
    value = strings[Number(rawValue)] ?? rawValue;
  } else if (type === "inlineStr") {
    value = descendantsByLocalName(cell, "t")
      .map((textRun) => textRun.textContent ?? "")
      .join("");
  } else if (type === "b") {
    value = rawValue === "1" ? "TRUE" : "FALSE";
  } else if (type === "e") {
    value = rawValue ? `#${rawValue}` : "";
  } else if (rawValue) {
    value = dateStyles.has(style)
      ? formatExcelDate(rawValue, date1904)
      : rawValue;
  }

  value = cleanText(value);
  if (formula) {
    return value ? `${value} (formula: =${formula})` : `=${formula}`;
  }
  return value;
}

function sheetRows(
  xml: string,
  strings: string[],
  dateStyles: Set<number>,
  date1904: boolean,
): string[] {
  const doc = parseXml(xml);
  const lines: string[] = [];

  for (const row of descendantsByLocalName(doc, "row")) {
    const values: string[] = [];
    for (const cell of childrenByLocalName(row, "c")) {
      const index = columnIndex(attr(cell, "r") ?? "") ?? values.length;
      values[index] = cellValue(cell, strings, dateStyles, date1904);
    }

    while (values.length > 0 && !values[values.length - 1]) values.pop();
    if (values.some(Boolean)) {
      lines.push(values.map((value) => value ?? "").join("\t"));
    }
  }

  return lines;
}

export class XlsxLoader implements DocumentLoader {
  async load(file: File): Promise<DocumentExtraction> {
    const zip = await loadZip(file);
    const [strings, styles, workbook] = await Promise.all([
      sharedStrings(zip),
      dateStyleIndexes(zip),
      workbookInfo(zip),
    ]);

    const sections: string[] = [];
    for (const sheet of workbook.sheets) {
      const xml = await zipText(zip, sheet.path);
      if (!xml) continue;
      const rows = sheetRows(xml, strings, styles, workbook.date1904);
      if (rows.length > 0) {
        sections.push(`Sheet: ${sheet.name}\n${rows.join("\n")}`);
      }
    }

    const text = sections.join("\n\n").trim();
    if (!text) {
      return {
        kind: "skipped",
        reason: "This spreadsheet does not contain readable cells.",
      };
    }

    return { kind: "text", text: clampDocumentText(text) };
  }
}
