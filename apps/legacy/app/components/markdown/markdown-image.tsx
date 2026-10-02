import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconPhotoOff } from "@tabler/icons-react";

import {
  fitDims,
  IMAGE_PLACEHOLDER_SIZE,
  ImageShimmer,
} from "~/components/generated-image";
import { ImageViewer } from "~/components/image-viewer";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

// An image embedded in a reply with standard markdown syntax — a generated
// picture the model placed in its prose, or a direct link it's showing. Same
// framed look and shimmer-while-loading arc as attachment/generated images so
// pictures feel like one family. Everything here is a <span> because
// react-markdown mounts images inside <p> tags, where block elements would be
// invalid HTML.

const frameClass =
  "relative my-1.5 block overflow-hidden rounded-[14px] border border-black/[0.06] bg-black/[0.03] dark:border-white/[0.08] dark:bg-white/[0.05]";

/** Only load plain web/data-image URLs; anything else renders as the fallback. */
function isRenderableSrc(src: string): boolean {
  return (
    /^https?:\/\//i.test(src) ||
    src.startsWith("data:image/") ||
    src.startsWith("blob:")
  );
}

export function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const capture = useCapture();
  const [dims, setDims] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const label = alt?.trim() || "image";
  if (!src || !isRenderableSrc(src) || failed) {
    // A quiet broken-image chip: the alt text keeps the meaning, the icon
    // says why there's no picture. Inline so surrounding prose still flows.
    return (
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-black/[0.04] px-2 py-1 align-middle text-[13px] text-neutral-500 dark:bg-white/[0.06] dark:text-neutral-400">
        <IconPhotoOff size={14} stroke={2} className="shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    );
  }

  // The shimmer square holds the picture's spot until the bytes have fully
  // arrived (never the browser's own loading render), then the frame
  // spring-morphs to the real aspect ratio and the image blooms in — the same
  // arc MorphingImage runs for generated pictures.
  const display = dims
    ? fitDims(dims.width, dims.height)
    : { width: IMAGE_PLACEHOLDER_SIZE, height: IMAGE_PLACEHOLDER_SIZE };
  const loaded = dims !== null;

  return (
    <>
      <motion.span
        initial={false}
        animate={{ width: display.width, height: display.height }}
        transition={{ type: "spring", stiffness: 420, damping: 28 }}
        className={frameClass}
      >
        <AnimatePresence>
          {!loaded && (
            <motion.span
              key="shimmer"
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
              className="absolute inset-0 block"
            >
              <ImageShimmer as="span" label={`Loading ${label}`} />
            </motion.span>
          )}
        </AnimatePresence>
        <button
          type="button"
          aria-label={`Open ${label}`}
          onClick={() => {
            capture(ANALYTICS_EVENTS.markdownImageOpened);
            setOpen(true);
          }}
          className="absolute inset-0 block cursor-zoom-in"
        >
          <motion.img
            src={src}
            alt={label}
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setDims({ width: img.naturalWidth, height: img.naturalHeight });
              }
            }}
            onError={() => {
              setFailed(true);
              capture(ANALYTICS_EVENTS.markdownImageFailed);
            }}
            initial={{ opacity: 0, scale: 1.06, filter: "blur(14px)" }}
            animate={
              loaded ? { opacity: 1, scale: 1, filter: "blur(0px)" } : undefined
            }
            transition={{ duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </button>
      </motion.span>
      <AnimatePresence>
        {open && (
          <ImageViewer src={src} alt={label} onClose={() => setOpen(false)} />
        )}
      </AnimatePresence>
    </>
  );
}
