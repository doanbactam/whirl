import { useCallback, useRef, useState } from "react";

import type { Attachment, ModelKey } from "~/data/messages";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";
import {
  getAttachmentType,
  isTextAttachment,
  makeAttachmentId,
  prepareAttachment,
} from "~/lib/attachment-upload";

export type AttachmentDraft = {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  status: "uploading" | "ready" | "error";
  /**
   * Stable key tying this draft back to the document it was ingested from (e.g.
   * an edited sidebar doc), so later edits update this chip instead of adding a
   * new one. Absent for ordinary user-picked files.
   */
  sourceKey?: string;
  /** Upload progress, 0..1. */
  progress: number;
  /** Object URL for an instant image thumbnail (the original, pre-compression). */
  previewUrl?: string;
  /** Loaded/extracted text, for the click-to-read preview. */
  text?: string;
  /** Set once the upload finishes — this is what gets sent. */
  attachment?: Attachment;
  error?: string;
};

/**
 * Manages composer attachments that upload the moment they're added rather than
 * on send. Each file becomes a draft that tracks its own upload progress; once
 * ready it carries the {@link Attachment} to hand off. {@link resolveAttachments}
 * waits for anything still in flight before returning, so a fast send never
 * drops a file that hadn't finished uploading.
 */
export function useAttachmentUploads({
  getUploadUrl,
  model,
}: {
  getUploadUrl: () => Promise<string>;
  model: ModelKey;
}) {
  const capture = useCapture();
  const [drafts, setDrafts] = useState<AttachmentDraft[]>([]);
  const draftsRef = useRef<AttachmentDraft[]>([]);
  draftsRef.current = drafts;

  // In-flight uploads and their resolved attachments, kept in refs so a send
  // can await/read the freshest values without waiting on a re-render.
  const pendingRef = useRef(new Map<string, Promise<void>>());
  const readyRef = useRef(new Map<string, Attachment>());
  // sourceKey -> draft id, so repeated edits to the same document update one chip.
  const sourceKeyIdsRef = useRef(new Map<string, string>());

  // Latest upload params, so the async closure never closes over a stale model.
  const getUploadUrlRef = useRef(getUploadUrl);
  getUploadUrlRef.current = getUploadUrl;
  const modelRef = useRef(model);
  modelRef.current = model;

  const patch = useCallback((id: string, p: Partial<AttachmentDraft>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...p } : d)));
  }, []);

  // Turn files into drafts and kick off their uploads. The shared core behind
  // both user-picked files and programmatically ingested docs; per-file `meta`
  // lets callers pin an id/sourceKey so a later edit can find the same chip.
  const ingestFiles = useCallback(
    (
      files: File[],
      meta?: (file: File, index: number) => Partial<AttachmentDraft>,
    ) => {
      if (files.length === 0) return;

      // Names must be unique within the tray: pasted images all arrive as
      // "image.png", and duplicate names break everything keyed on them — the
      // @mention picks the wrong preview, and the model can't tell which
      // "@image.png" the user meant. Dupes get a "-2"/"-3" suffix before the
      // extension, and the send path carries the renamed name too.
      const takenNames = new Set(
        draftsRef.current.map((d) => d.name.toLowerCase()),
      );
      const uniqueName = (original: string): string => {
        if (!takenNames.has(original.toLowerCase())) {
          takenNames.add(original.toLowerCase());
          return original;
        }
        const dot = original.lastIndexOf(".");
        const base = dot > 0 ? original.slice(0, dot) : original;
        const ext = dot > 0 ? original.slice(dot) : "";
        let n = 2;
        while (takenNames.has(`${base}-${n}${ext}`.toLowerCase())) n += 1;
        const candidate = `${base}-${n}${ext}`;
        takenNames.add(candidate.toLowerCase());
        return candidate;
      };

      // Image names double as @mention handles, so OS-generated mouthfuls
      // ("Screenshot 2026-07-04 at 12.34.56.png") become a short generated
      // name instead — a long tag is unusable in the composer and noisy in
      // the prompt. Meaningful short names pass through untouched; dupes
      // pick up "-2"/"-3" from uniqueName above.
      const MAX_IMAGE_NAME_CHARS = 24;
      const shortName = (name: string, type: string): string => {
        if (!type.startsWith("image/")) return name;
        if (name.length <= MAX_IMAGE_NAME_CHARS) return name;
        const dot = name.lastIndexOf(".");
        const ext = dot > 0 ? name.slice(dot) : "";
        return `image${ext}`;
      };

      const items: AttachmentDraft[] = files.map((file, index) => {
        const draft: AttachmentDraft = {
          id: makeAttachmentId(),
          file,
          name: file.name,
          size: file.size,
          type: getAttachmentType(file),
          status: "uploading",
          progress: 0,
          previewUrl: file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : undefined,
          ...meta?.(file, index),
        };
        return { ...draft, name: uniqueName(shortName(draft.name, draft.type)) };
      });
      setDrafts((prev) => [...prev, ...items]);

      for (const item of items) {
        // Pull text-file contents up front so the preview opens instantly.
        if (isTextAttachment(item.file)) {
          item.file
            .text()
            .then((t) => patch(item.id, { text: t }))
            .catch(() => {});
        }

        const promise = prepareAttachment(
          item.file,
          () => getUploadUrlRef.current(),
          modelRef.current,
          capture,
          (fraction) => patch(item.id, { progress: fraction }),
        )
          .then(({ attachment, text }) => {
            // prepareAttachment names the attachment after the raw file; the
            // draft's (possibly de-duplicated) name is the one the user tags
            // and the model is told about, so it wins.
            const named = { ...attachment, name: item.name };
            readyRef.current.set(item.id, named);
            patch(item.id, {
              status: "ready",
              progress: 1,
              attachment: named,
              size: named.size,
              ...(text !== undefined ? { text } : {}),
            });
          })
          .catch((err) => {
            patch(item.id, {
              status: "error",
              error: err instanceof Error ? err.message : "Upload failed",
            });
            capture(ANALYTICS_EVENTS.attachmentUploadFailed, {
              type: item.type,
            });
          })
          .finally(() => {
            pendingRef.current.delete(item.id);
          });
        pendingRef.current.set(item.id, promise);
      }
    },
    [capture, patch],
  );

  const addFiles = useCallback(
    (incoming: FileList | File[] | null | undefined) => {
      if (!incoming) return;
      const files = Array.from(incoming);
      if (files.length === 0) return;

      capture(ANALYTICS_EVENTS.attachmentAdded, {
        count: files.length,
        types: files.map((f) => f.type || "unknown"),
        total_bytes: files.reduce((sum, f) => sum + f.size, 0),
      });
      ingestFiles(files);
    },
    [capture, ingestFiles],
  );

  /**
   * Edit a draft's text in place (from the editable preview). Keeps the
   * already-uploaded attachment in sync so the edit is what actually gets sent.
   */
  const updateText = useCallback(
    (id: string, text: string) => {
      patch(id, { text });
      const ready = readyRef.current.get(id);
      if (ready) readyRef.current.set(id, { ...ready, text });
    },
    [patch],
  );

  /**
   * Add an edited document (identified by {@link key}) to the tray, or fold the
   * new text into the chip already there. Used when a sent document is edited in
   * the sidebar and needs to ride along on the next message. Returns true only
   * the first time a given document lands, so callers can announce it once.
   */
  const upsertTextDraft = useCallback(
    (
      key: string,
      doc: { name: string; type: string; text: string },
    ): boolean => {
      const existingId = sourceKeyIdsRef.current.get(key);
      if (existingId) {
        updateText(existingId, doc.text);
        return false;
      }
      // Reserve the id synchronously so a fast second edit (before setDrafts has
      // flushed) updates this draft instead of racing in a duplicate.
      const id = makeAttachmentId();
      sourceKeyIdsRef.current.set(key, id);
      // Edited markdown is already plain text in memory, so there's nothing to
      // upload — the prose rides inline on the attachment's `text`. Build a
      // ready draft straight away (no `storageId`, no upload round-trip), which
      // also skips the "uploading" progress bar and the send-time wait.
      const type = getAttachmentType({ name: doc.name, type: doc.type });
      const file = new File([doc.text], doc.name, { type: doc.type });
      const size = file.size;
      const attachment: Attachment = {
        id: makeAttachmentId(),
        name: doc.name,
        size,
        type,
        text: doc.text,
      };
      readyRef.current.set(id, attachment);
      setDrafts((prev) => [
        ...prev,
        {
          id,
          file,
          name: doc.name,
          size,
          type,
          status: "ready",
          progress: 1,
          sourceKey: key,
          text: doc.text,
          attachment,
        },
      ]);
      return true;
    },
    [updateText],
  );

  const remove = useCallback(
    (id: string) => {
      const target = draftsRef.current.find((d) => d.id === id);
      if (target) {
        capture(ANALYTICS_EVENTS.attachmentRemoved, { type: target.type });
        if (target.previewUrl) URL.revokeObjectURL(target.previewUrl);
        if (target.sourceKey) sourceKeyIdsRef.current.delete(target.sourceKey);
      }
      pendingRef.current.delete(id);
      readyRef.current.delete(id);
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    },
    [capture],
  );

  const clear = useCallback(() => {
    for (const d of draftsRef.current) {
      if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
    }
    pendingRef.current.clear();
    readyRef.current.clear();
    sourceKeyIdsRef.current.clear();
    setDrafts([]);
  }, []);

  /**
   * Wait for every in-flight upload to settle, then hand back the ready
   * attachments in draft order. Draft order/presence come from the ref (always
   * current); the attachment objects come from {@link readyRef}, sidestepping
   * any render lag on the just-finished uploads.
   */
  const resolveAttachments = useCallback(async (): Promise<Attachment[]> => {
    await Promise.allSettled(Array.from(pendingRef.current.values()));
    return draftsRef.current
      .map((d) => {
        const attachment = readyRef.current.get(d.id);
        if (!attachment) return undefined;
        // Preview text may be ready (or edited) before prepareAttachment
        // finishes; make sure it rides along on the attachment we actually send.
        if (d.text !== undefined && d.text !== attachment.text) {
          return { ...attachment, text: d.text };
        }
        return attachment;
      })
      .filter((a): a is Attachment => Boolean(a));
  }, []);

  return {
    drafts,
    addFiles,
    remove,
    updateText,
    upsertTextDraft,
    clear,
    resolveAttachments,
  };
}
