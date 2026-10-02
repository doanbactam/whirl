import { clampDocumentText } from "./shared";
import type { DocumentExtraction, DocumentLoader } from "./types";

const MIN_PDF_TEXT_CHARS = 20;

type CanvasPolyfills = {
  DOMMatrix?: typeof DOMMatrix;
  DOMPoint?: typeof DOMPoint;
  DOMRect?: typeof DOMRect;
  Path2D?: typeof Path2D;
};

type PdfJs = typeof import("pdfjs-dist");

let pdfWorkerReady = false;

async function setupNodePdfEnvironment() {
  if (typeof globalThis.DOMMatrix !== "undefined") {
    return;
  }

  try {
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<CanvasPolyfills>;
    const canvas = await dynamicImport("@napi-rs/canvas");
    const globals = globalThis as unknown as CanvasPolyfills;
    if (canvas.DOMMatrix) globals.DOMMatrix = canvas.DOMMatrix;
    if (canvas.DOMPoint) globals.DOMPoint = canvas.DOMPoint;
    if (canvas.DOMRect) globals.DOMRect = canvas.DOMRect;
    if (canvas.Path2D) globals.Path2D = canvas.Path2D;
  } catch {
    // pdfjs-dist may still work in browsers; Node paths need this only for SSR/tests.
  }
}

async function loadPdfJs(): Promise<PdfJs> {
  await setupNodePdfEnvironment();
  return await import("pdfjs-dist");
}

function setupPdfWorker(pdfjs: PdfJs) {
  if (
    pdfWorkerReady ||
    typeof document === "undefined" ||
    typeof Worker === "undefined"
  ) {
    return;
  }

  pdfjs.GlobalWorkerOptions.workerPort = new Worker(
    new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
    { type: "module" },
  );
  pdfWorkerReady = true;
}

export class PdfLoader implements DocumentLoader {
  async load(file: File): Promise<DocumentExtraction> {
    const pdfjs = await loadPdfJs();
    setupPdfWorker(pdfjs);

    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data });
    const pdf = await loadingTask.promise;

    const pages: string[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim();
      if (pageText) pages.push(pageText);
    }
    await loadingTask.destroy();

    const text = pages.join("\n\n").trim();
    if (text.replace(/\s/g, "").length < MIN_PDF_TEXT_CHARS) {
      return { kind: "passthrough" };
    }

    return { kind: "text", text: clampDocumentText(text) };
  }
}
