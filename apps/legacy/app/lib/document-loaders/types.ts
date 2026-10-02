export type DocumentExtraction =
  | { kind: "text"; text: string }
  | { kind: "passthrough" }
  | { kind: "skipped"; reason: string };

export interface DocumentLoader {
  load(file: File): Promise<DocumentExtraction>;
}

export type DocumentLoaderClass = new () => DocumentLoader;
