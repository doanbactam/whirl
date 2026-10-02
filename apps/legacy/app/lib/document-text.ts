import {
  getDocumentLoader,
  getDocumentType,
  isExtractableDocument,
  type DocumentExtraction,
} from "./document-loaders";

export { isExtractableDocument };

/**
 * Extract readable text from supported document formats. Never throws — any
 * failure resolves to a `skipped` result so the surrounding send flow keeps
 * going.
 */
export async function extractDocumentText(
  file: File,
): Promise<DocumentExtraction> {
  const documentType = getDocumentType(file.type, file.name);

  if (
    documentType === "doc" ||
    documentType === "ppt" ||
    documentType === "xls"
  ) {
    return {
      kind: "skipped",
      reason:
        `Legacy .${documentType} files aren't supported - ` +
        `save it as .${documentType}x.`,
    };
  }

  try {
    if (documentType) {
      const Loader = await getDocumentLoader(documentType);
      return await new Loader().load(file);
    }
  } catch {
    return {
      kind: "skipped",
      reason: "This document couldn't be read.",
    };
  }

  return { kind: "skipped", reason: "Unsupported document type." };
}
