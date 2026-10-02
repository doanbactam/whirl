import type { DocumentLoaderClass } from "./types";

export type { DocumentExtraction } from "./types";

export type SupportedDocumentType =
  | "docx"
  | "odp"
  | "ods"
  | "odt"
  | "pdf"
  | "pptx"
  | "rtf"
  | "xlsx";
type LegacyDocumentType = "doc" | "ppt" | "xls";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ODT_MIME = "application/vnd.oasis.opendocument.text";
const ODP_MIME = "application/vnd.oasis.opendocument.presentation";
const ODS_MIME = "application/vnd.oasis.opendocument.spreadsheet";

type LazyLoaderFactory = () => Promise<DocumentLoaderClass>;

const lazyDocumentLoaders: Record<SupportedDocumentType, LazyLoaderFactory> = {
  docx: async () => {
    const { DocxLoader } = await import("./docx");
    return DocxLoader;
  },
  pdf: async () => {
    const { PdfLoader } = await import("./pdf");
    return PdfLoader;
  },
  pptx: async () => {
    const { PptxLoader } = await import("./ooxml");
    return PptxLoader;
  },
  xlsx: async () => {
    const { XlsxLoader } = await import("./ooxml");
    return XlsxLoader;
  },
  odt: async () => {
    const { OpenDocumentLoader } = await import("./opendocument");
    return OpenDocumentLoader;
  },
  ods: async () => {
    const { OpenDocumentLoader } = await import("./opendocument");
    return OpenDocumentLoader;
  },
  odp: async () => {
    const { OpenDocumentLoader } = await import("./opendocument");
    return OpenDocumentLoader;
  },
  rtf: async () => {
    const { RtfLoader } = await import("./rtf");
    return RtfLoader;
  },
};

export function getDocumentType(
  mimeType: string,
  name: string,
): SupportedDocumentType | LegacyDocumentType | null {
  const type = mimeType.toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";

  if (
    type === DOCX_MIME ||
    type === "application/vnd.ms-word.document.macroenabled.12" ||
    ["docx", "docm", "dotx"].includes(ext ?? "")
  ) {
    return "docx";
  }
  if (type === "application/msword" || ext === "doc") return "doc";
  if (type === PDF_MIME || ext === "pdf") return "pdf";
  if (
    type === PPTX_MIME ||
    type === "application/vnd.ms-powerpoint.presentation.macroenabled.12" ||
    ["pptx", "pptm", "ppsx"].includes(ext ?? "")
  ) {
    return "pptx";
  }
  if (type === "application/vnd.ms-powerpoint" || ext === "ppt") {
    return "ppt";
  }
  if (
    type === XLSX_MIME ||
    type === "application/vnd.ms-excel.sheet.macroenabled.12" ||
    ["xlsx", "xlsm", "xltx"].includes(ext ?? "")
  ) {
    return "xlsx";
  }
  if (type === "application/vnd.ms-excel" || ext === "xls") return "xls";
  if (type === ODT_MIME || ext === "odt") return "odt";
  if (type === ODS_MIME || ext === "ods") return "ods";
  if (type === ODP_MIME || ext === "odp") return "odp";
  if (["application/rtf", "text/rtf"].includes(type) || ext === "rtf") {
    return "rtf";
  }
  return null;
}

export function isExtractableDocument(type: string, name: string): boolean {
  return getDocumentType(type, name) !== null;
}

export async function getDocumentLoader(
  fileType: SupportedDocumentType,
): Promise<DocumentLoaderClass> {
  return lazyDocumentLoaders[fileType]();
}
