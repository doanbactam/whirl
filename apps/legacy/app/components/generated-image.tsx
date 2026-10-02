import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconCheck, IconCopy, IconDownload } from "@tabler/icons-react";

import type { Attachment, Message } from "~/data/messages";
import { ImageViewer } from "~/components/image-viewer";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";
import { showToast } from "~/data/toasts";

// The generated-image slot in an assistant bubble. While the model paints, a
// square shimmer placeholder holds the space; the moment the attachment lands
// (reactively, via the message row) the placeholder morphs to the image's real
// aspect ratio and the picture blooms in. The placeholder and the pre-load
// state of the real image are pixel-identical, so the handoff is seamless.

export const IMAGE_PLACEHOLDER_SIZE = 240;
const MAX_WIDTH = 360;
const MAX_HEIGHT = 400;

/** Scale a picture's natural size into the chat's image frame bounds. Shared
 * with markdown-embedded images so every picture sits in the same geometry. */
export function fitDims(width: number, height: number) {
  const scale = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height, 1);
  return {
    width: Math.max(120, Math.round(width * scale)),
    height: Math.max(120, Math.round(height * scale)),
  };
}

export const imageFrameClass =
  "relative block overflow-hidden rounded-[14px] border border-black/[0.06] bg-black/[0.03] dark:border-white/[0.08] dark:bg-white/[0.05]";

/** The quiet square that holds the image's spot while it's being painted:
 * a still base with a single gleam sweeping across it. The gleam is a CSS
 * keyframe (`.image-shimmer-gleam`), NOT framer-motion — the message row
 * re-renders on every reactive update while the turn is live, which restarts
 * a JS keyframe loop each render and froze the gleam off-screen in prod. */
export function ImageShimmer({
  label,
  as: Tag = "div",
}: {
  label: string;
  /** Use "span" inside phrasing content — markdown mounts images in <p>. */
  as?: "div" | "span";
}) {
  return (
    <Tag
      role="status"
      aria-label={label}
      className="absolute inset-0 overflow-hidden"
    >
      <Tag className="absolute inset-0 bg-black/[0.05] dark:bg-white/[0.07]" />
      <Tag
        aria-hidden
        className="image-shimmer-gleam absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/[0.14]"
      />
    </Tag>
  );
}

/** Fetch the image bytes, re-encoding to PNG when the clipboard demands it. */
async function fetchImageBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch failed (${response.status})`);
  return await response.blob();
}

async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return await canvas.convertToBlob({ type: "image/png" });
}

/** A frosted-glass icon button that sits on top of the picture. */
function GlassButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      whileTap={{ scale: 0.92 }}
      className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.18] bg-black/35 text-white shadow-[0_1px_4px_rgba(0,0,0,0.25)] backdrop-blur-md backdrop-saturate-150 transition-colors hover:bg-black/55"
    >
      {children}
    </motion.button>
  );
}

/**
 * One generated image: starts as the shimmer square, then spring-morphs to the
 * picture's natural aspect ratio and reveals it with a blur-bloom once the
 * bytes have actually arrived. Click opens the fullscreen viewer; glassy
 * copy/download buttons float in the top-right corner.
 */
export function MorphingImage({ attachment }: { attachment: Attachment }) {
  const [dims, setDims] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<number | null>(null);
  const capture = useCapture();
  const display = dims
    ? fitDims(dims.width, dims.height)
    : { width: IMAGE_PLACEHOLDER_SIZE, height: IMAGE_PLACEHOLDER_SIZE };
  const revealed = dims !== null;

  useEffect(
    () => () => {
      if (copyResetRef.current != null) {
        window.clearTimeout(copyResetRef.current);
      }
    },
    [],
  );

  const copyImage = () => {
    if (!attachment.url) return;
    // Flip to the check the instant the button is pressed — the confirmation
    // should answer the click, not the network. Handing the clipboard a
    // *promise* of the PNG keeps the write inside the user gesture (Safari
    // insists) while the bytes fetch + re-encode behind it; on failure the
    // check reverts and the toast explains.
    setCopied(true);
    if (copyResetRef.current != null) {
      window.clearTimeout(copyResetRef.current);
    }
    copyResetRef.current = window.setTimeout(() => setCopied(false), 1500);
    // Clipboards only take PNG, so anything else is re-encoded on the fly.
    const png = fetchImageBlob(attachment.url).then(toPngBlob);
    navigator.clipboard
      .write([new ClipboardItem({ "image/png": png })])
      .then(() => capture(ANALYTICS_EVENTS.generatedImageCopied))
      .catch(() => {
        if (copyResetRef.current != null) {
          window.clearTimeout(copyResetRef.current);
        }
        setCopied(false);
        showToast({ message: "couldn't copy the image 😔", tone: "danger" });
      });
  };

  const downloadImage = async () => {
    if (!attachment.url) return;
    try {
      // The storage URL is cross-origin, where the download attribute is
      // ignored — pull the bytes and hand over an object URL instead.
      const blob = await fetchImageBlob(attachment.url);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = attachment.name || "generated-image.png";
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      capture(ANALYTICS_EVENTS.generatedImageDownloaded);
    } catch {
      showToast({ message: "couldn't download the image 😔", tone: "danger" });
    }
  };

  return (
    <>
      <motion.div
        initial={false}
        animate={{ width: display.width, height: display.height }}
        transition={{ type: "spring", stiffness: 420, damping: 28 }}
        className={`group/genimg ${imageFrameClass}`}
      >
        <AnimatePresence>
          {!revealed && (
            <motion.div
              key="shimmer"
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
              className="absolute inset-0"
            >
              <ImageShimmer label="Generating image" />
            </motion.div>
          )}
        </AnimatePresence>
        <motion.img
          src={attachment.url}
          alt={attachment.name}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setDims({ width: img.naturalWidth, height: img.naturalHeight });
            }
          }}
          initial={{ opacity: 0, scale: 1.06, filter: "blur(14px)" }}
          animate={
            revealed ? { opacity: 1, scale: 1, filter: "blur(0px)" } : undefined
          }
          transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {revealed && (
          <>
            {/* Full-bleed click target under the action cluster. */}
            <button
              type="button"
              aria-label={`Open ${attachment.name}`}
              onClick={() => {
                capture(ANALYTICS_EVENTS.attachmentImageOpened);
                setOpen(true);
              }}
              className="absolute inset-0 transition-opacity hover:opacity-95"
            />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.25,
                delay: 0.3,
                ease: [0.22, 0.61, 0.36, 1],
              }}
              className="absolute right-1.5 top-1.5 flex gap-1 opacity-100 transition-opacity duration-150 md:opacity-0 md:group-hover/genimg:opacity-100 md:group-focus-within/genimg:opacity-100"
            >
              <GlassButton
                label={copied ? "Copied" : "Copy image"}
                onClick={copyImage}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={copied ? "check" : "copy"}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ duration: 0.12, ease: "easeOut" }}
                    className="flex"
                  >
                    {copied ? (
                      <IconCheck size={14} stroke={2.5} />
                    ) : (
                      <IconCopy size={14} stroke={2} />
                    )}
                  </motion.span>
                </AnimatePresence>
              </GlassButton>
              <GlassButton label="Download image" onClick={downloadImage}>
                <IconDownload size={14} stroke={2} />
              </GlassButton>
            </motion.div>
          </>
        )}
      </motion.div>
      <AnimatePresence>
        {open && attachment.url && (
          <ImageViewer
            src={attachment.url}
            alt={attachment.name}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * The whole slot for an Image-model assistant message: shimmer placeholder
 * while generating, morphing image(s) once they land, nothing when the turn
 * was stopped or errored before anything was painted.
 */
export function GeneratedImageSlot({ message }: { message: Message }) {
  const images = (message.attachments ?? []).filter(
    (a) => a.type.startsWith("image/") && a.url,
  );
  const generating =
    images.length === 0 &&
    (message.status === "thinking" ||
      message.status === "searching" ||
      message.status === "streaming");

  if (!generating && images.length === 0) return null;

  return (
    <div
      className={`flex max-w-[80%] min-w-0 flex-wrap gap-1.5 self-start ${
        message.content.trim() ? "mb-1.5" : ""
      }`}
    >
      {generating ? (
        <div
          className={imageFrameClass}
          style={{ width: IMAGE_PLACEHOLDER_SIZE, height: IMAGE_PLACEHOLDER_SIZE }}
        >
          <ImageShimmer label="Generating image" />
        </div>
      ) : (
        images.map((image) => (
          <MorphingImage key={image.id} attachment={image} />
        ))
      )}
    </div>
  );
}
