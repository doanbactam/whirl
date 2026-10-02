import type { Attachment, ModelKey } from "~/data/messages";
import { modelLabel } from "~/data/models";
import { ANALYTICS_EVENTS, type useCapture } from "~/lib/posthog";
import {
  extractDocumentText,
  isExtractableDocument,
} from "~/lib/document-text";

type CaptureFn = ReturnType<typeof useCapture>;

const MB = 1024 * 1024;

// Free-plan attachments are capped harder than any model's own limit: free
// users can attach files up to 1 MB regardless of which model they're on.
// Images are exempt — they're auto-compressed before upload, so the cap only
// bites uncompressed documents/audio/video. The source of truth for *who's* on
// the free plan is Autumn; this is just the cap.
export const FREE_MAX_FILE_BYTES = 1 * MB;

// Attachment support per tier mirrors each underlying model's OpenRouter
// `architecture.input_modalities`. Keep in sync with MODEL_IDS in
// convex/inference/billing.ts; verify against
// https://openrouter.ai/api/v1/models when adding or swapping a model.
const ATTACHMENT_LIMITS: Record<
  ModelKey,
  {
    maxFileBytes: number;
    images: boolean;
    files: boolean;
    audio: boolean;
    video: boolean;
  }
> = {
  // openrouter/auto — text, image, audio, file, video
  Auto: { maxFileBytes: 20 * MB, images: true, files: true, audio: true, video: true },
  // openai/gpt-5.4-nano — text, image
  Fast: { maxFileBytes: 20 * MB, images: true, files: false, audio: false, video: false },
  // moonshotai/kimi-k2.6 — text, image (no native file input; PDFs and Office
  // docs still ride along as text extracted at upload)
  Basic: { maxFileBytes: 20 * MB, images: true, files: false, audio: false, video: false },
  // x-ai/grok-4.5 — text, image, file (no audio/video)
  Max: { maxFileBytes: 20 * MB, images: true, files: true, audio: false, video: false },
  // openai/gpt-image-2 — images in, images out; documents/audio/video mean
  // nothing to a picture painter.
  Image: { maxFileBytes: 20 * MB, images: true, files: false, audio: false, video: false },
};

const IMAGE_CONSTRAINTS: Record<
  ModelKey,
  { maxLongEdge: number; maxMegapixels: number } | null
> = {
  Auto: { maxLongEdge: 1568, maxMegapixels: 2.5 },
  Fast: { maxLongEdge: 1568, maxMegapixels: 4 },
  // Kimi and Grok don't publish hard pixel caps like Anthropic did; keep the
  // conservative bounds the other tiers use so uploads never bounce.
  Basic: { maxLongEdge: 1568, maxMegapixels: 4 },
  Max: { maxLongEdge: 1568, maxMegapixels: 4 },
  Image: { maxLongEdge: 1568, maxMegapixels: 4 },
};

const COMPRESSIBLE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/tiff",
]);

const TARGET_COMPRESSED_BYTES = 4 * MB;

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "c",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "dart",
  "diff",
  "env",
  "go",
  "h",
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

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  conf: "text/plain",
  csv: "text/csv",
  diff: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  docm: "application/vnd.ms-word.document.macroEnabled.12",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  htm: "text/html",
  html: "text/html",
  // Browsers report an empty type for .jsonc — without this it lands on
  // application/octet-stream and the model never gets the text.
  jsonc: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  mdx: "text/markdown",
  odp: "application/vnd.oasis.opendocument.presentation",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odt: "application/vnd.oasis.opendocument.text",
  patch: "text/plain",
  pdf: "application/pdf",
  ppt: "application/vnd.ms-powerpoint",
  pptm: "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
  rtf: "application/rtf",
  sql: "application/sql",
  toml: "application/toml",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  xls: "application/vnd.ms-excel",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xltx: "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
};

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

/** The fields the metadata/validation helpers need — both `File` and
 * {@link Attachment} satisfy this, so the same checks run on a freshly-picked
 * file and a fully-uploaded attachment. */
type FileLike = { name: string; type: string; size: number };

export function getFileExtension(name: string) {
  return name.includes(".") ? name.split(".").pop()?.toLowerCase() ?? "" : "";
}

export function getAttachmentType(file: Pick<FileLike, "name" | "type">) {
  return (
    file.type ||
    MIME_TYPES_BY_EXTENSION[getFileExtension(file.name)] ||
    "application/octet-stream"
  );
}

export function isTextAttachment(file: Pick<FileLike, "name" | "type">) {
  return (
    getAttachmentType(file).startsWith("text/") ||
    TEXT_ATTACHMENT_EXTENSIONS.has(getFileExtension(file.name))
  );
}

/** Whether the model accepts any kind of attachment at all. */
export function modelAcceptsAttachments(model: ModelKey) {
  const l = ATTACHMENT_LIMITS[model];
  return l.images || l.files || l.audio || l.video;
}

export function makeAttachmentId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Why a file can't ride along with the chosen model, or `null` if it's fine.
 * Reactive to the model the user has selected — the same file may be welcome on
 * one tier and rejected on another.
 */
export function attachmentRejectionReason(
  file: FileLike,
  model: ModelKey,
  isFree = false,
): string | null {
  const type = getAttachmentType(file);
  const limits = ATTACHMENT_LIMITS[model];
  const label = modelLabel(model);
  const isImage = type.startsWith("image/");
  // Images are auto-compressed before upload (bounded to a few MB by
  // compressImage), so — exactly like the per-model byte limit below — they're
  // exempt from the raw free-tier cap. Without this guard a free user's photo
  // compresses to >1 MB, the chip flags it as rejected, and the send button
  // stays disabled: they can attach an image but never send it. The cap is here
  // to keep *uncompressed* documents/audio/video in check, not images.
  if (isFree && !isImage && file.size > FREE_MAX_FILE_BYTES) {
    return `Free plan attachments are limited to ${formatSize(FREE_MAX_FILE_BYTES)}. Upgrade for larger files.`;
  }
  if (!isImage && file.size > limits.maxFileBytes) {
    return `${label} supports attachments up to ${formatSize(limits.maxFileBytes)}.`;
  }
  if (isTextAttachment(file)) return null;
  if (isImage) {
    return limits.images ? null : `${label} doesn't support images.`;
  }
  if (type.startsWith("audio/")) {
    return limits.audio ? null : `${label} doesn't support audio.`;
  }
  if (type.startsWith("video/")) {
    return limits.video ? null : `${label} doesn't support video.`;
  }
  // Extractable documents (PDF, Office, OpenDocument, RTF) are welcome on
  // every tier: they're converted to text at upload, so the model reads them
  // even without native file input. The one gap — a scanned PDF with no text
  // layer — is omitted server-side with a note on tiers without `files`.
  if (isExtractableDocument(type, file.name)) return null;
  return limits.files ? null : `${label} only supports text attachments.`;
}

async function compressImage(file: File, model: ModelKey): Promise<File> {
  const constraints = IMAGE_CONSTRAINTS[model];
  if (!constraints) return file;
  if (!COMPRESSIBLE_IMAGE_TYPES.has(file.type)) return file;
  if (typeof OffscreenCanvas === "undefined") return file;

  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;

  const longEdge = Math.max(width, height);
  if (longEdge > constraints.maxLongEdge) {
    const scale = constraints.maxLongEdge / longEdge;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const mp = (width * height) / 1_000_000;
  if (mp > constraints.maxMegapixels) {
    const scale = Math.sqrt(constraints.maxMegapixels / mp);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const needsResize = width !== bitmap.width || height !== bitmap.height;
  if (!needsResize && file.size <= TARGET_COMPRESSED_BYTES) {
    bitmap.close();
    return file;
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  let quality = 0.85;
  let blob = await canvas.convertToBlob({ type: outputType, quality });

  while (blob.size > TARGET_COMPRESSED_BYTES && quality > 0.3) {
    quality -= 0.1;
    blob = await canvas.convertToBlob({ type: outputType, quality });
  }

  if (blob.size > TARGET_COMPRESSED_BYTES && outputType === "image/png") {
    quality = 0.8;
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    while (blob.size > TARGET_COMPRESSED_BYTES && quality > 0.3) {
      quality -= 0.1;
      blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    }
  }

  const ext = blob.type === "image/png" ? ".png" : ".jpg";
  const newName = file.name.replace(/\.[^.]+$/, ext);
  return new File([blob], newName, { type: blob.type });
}

// fetch() can't report upload progress, so the POST to Convex storage goes
// through XHR — that's the only reason this isn't a one-liner.
function uploadToStorage(
  url: string,
  type: string,
  body: Blob,
  onProgress?: (fraction: number) => void,
): Promise<{ storageId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as { storageId: string });
        } catch {
          reject(new Error("Malformed upload response"));
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(body);
  });
}

/**
 * Compresses images, extracts readable document text, and uploads a single file
 * to Convex storage, reporting upload progress along the way. Returns the
 * ready-to-send {@link Attachment} plus any extracted prose for previews.
 */
export async function prepareAttachment(
  f: File,
  getUploadUrl: () => Promise<string>,
  model: ModelKey,
  capture: CaptureFn,
  onProgress?: (fraction: number) => void,
): Promise<{ attachment: Attachment; text?: string }> {
  const originalType = getAttachmentType(f);
  const file =
    originalType.startsWith("image/") ? await compressImage(f, model) : f;
  const type = getAttachmentType(file);

  // Pull readable text out of supported documents in the browser, in parallel
  // with the upload — both just need the file. The extracted text rides along
  // in the attachment's `text` field so the model gets clean prose instead of a
  // raw binary blob it can't read.
  const extractionPromise = isExtractableDocument(type, file.name)
    ? extractDocumentText(file)
    : Promise.resolve(null);
  const textPromise = isTextAttachment(file)
    ? file.text()
    : Promise.resolve(undefined);

  const uploadUrl = await getUploadUrl();
  const [uploadResult, extraction, textContent] = await Promise.all([
    uploadToStorage(uploadUrl, type, file, onProgress),
    extractionPromise,
    textPromise,
  ]);

  const attachment: Attachment = {
    id: makeAttachmentId(),
    name: f.name,
    size: file.size,
    type,
    storageId: uploadResult.storageId,
    url: type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
  };

  let text: string | undefined;
  if (textContent !== undefined) {
    attachment.text = textContent;
    text = textContent;
  }
  if (extraction) {
    if (extraction.kind === "text") {
      attachment.text = extraction.text;
      text = extraction.text;
    } else if (extraction.kind === "skipped") {
      attachment.skippedReason = extraction.reason;
    }
    // A `passthrough` PDF keeps no text — it rides through as a native file
    // block so vision-capable models can still read the pages.
    capture(ANALYTICS_EVENTS.documentExtracted, {
      fileType: type,
      outcome: extraction.kind,
      charCount: extraction.kind === "text" ? extraction.text.length : 0,
    });
  }

  return { attachment, text };
}
