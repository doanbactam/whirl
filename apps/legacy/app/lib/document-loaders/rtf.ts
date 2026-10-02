import { clampDocumentText } from "./shared";
import type { DocumentExtraction, DocumentLoader } from "./types";

const IGNORED_DESTINATIONS = new Set([
  "annotation",
  "colortbl",
  "datastore",
  "filetbl",
  "fonttbl",
  "footer",
  "footerf",
  "footerl",
  "footerr",
  "header",
  "headerf",
  "headerl",
  "headerr",
  "info",
  "object",
  "pict",
  "stylesheet",
  "themedata",
]);

type RtfState = {
  ignored: boolean;
};

function decodeHexByte(hex: string): string {
  const byte = Number.parseInt(hex, 16);
  if (!Number.isFinite(byte)) return "";

  try {
    return new TextDecoder("windows-1252").decode(Uint8Array.of(byte));
  } catch {
    return String.fromCharCode(byte);
  }
}

function unicodeChar(value: number): string {
  const codePoint = value < 0 ? value + 65536 : value;
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return "";
  }
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function rtfToText(input: string): string {
  const states: RtfState[] = [{ ignored: false }];
  let out = "";
  let markNextGroupIgnored = false;
  let unicodeFallbackChars = 1;
  let skipFallback = 0;

  const current = () => states[states.length - 1] ?? states[0];

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (skipFallback > 0 && char !== "\\" && char !== "{" && char !== "}") {
      skipFallback -= 1;
      continue;
    }

    if (char === "{") {
      states.push({ ignored: current().ignored || markNextGroupIgnored });
      markNextGroupIgnored = false;
      continue;
    }

    if (char === "}") {
      if (states.length > 1) states.pop();
      markNextGroupIgnored = false;
      continue;
    }

    if (char !== "\\") {
      if (!current().ignored) out += char;
      continue;
    }

    i += 1;
    const next = input[i] ?? "";
    if (next === "*") {
      markNextGroupIgnored = true;
      continue;
    }

    if (next === "'" && i + 2 < input.length) {
      if (!current().ignored) out += decodeHexByte(input.slice(i + 1, i + 3));
      i += 2;
      continue;
    }

    if (["\\", "{", "}"].includes(next)) {
      if (!current().ignored) out += next;
      continue;
    }

    if (next === "~") {
      if (!current().ignored) out += " ";
      continue;
    }

    if (next === "-") {
      if (!current().ignored) out += "-";
      continue;
    }

    if (!/[a-zA-Z]/.test(next)) {
      continue;
    }

    let word = next;
    while (i + 1 < input.length && /[a-zA-Z]/.test(input[i + 1])) {
      i += 1;
      word += input[i];
    }

    let sign = 1;
    if (input[i + 1] === "-") {
      sign = -1;
      i += 1;
    }

    let digits = "";
    while (i + 1 < input.length && /\d/.test(input[i + 1])) {
      i += 1;
      digits += input[i];
    }
    const parameter = digits ? sign * Number(digits) : null;

    if (input[i + 1] === " ") i += 1;

    if (IGNORED_DESTINATIONS.has(word)) {
      current().ignored = true;
      continue;
    }

    if (current().ignored) continue;

    if (word === "par" || word === "line") out += "\n";
    else if (word === "tab") out += "\t";
    else if (word === "emdash") out += "--";
    else if (word === "endash") out += "-";
    else if (word === "bullet") out += "* ";
    else if (word === "uc" && parameter !== null) unicodeFallbackChars = parameter;
    else if (word === "u" && parameter !== null) {
      out += unicodeChar(parameter);
      skipFallback = unicodeFallbackChars;
    }
  }

  return normalizeExtractedText(out);
}

export class RtfLoader implements DocumentLoader {
  async load(file: File): Promise<DocumentExtraction> {
    const text = rtfToText(await file.text());
    if (!text) {
      return { kind: "skipped", reason: "This RTF file appears to be empty." };
    }

    return { kind: "text", text: clampDocumentText(text) };
  }
}

