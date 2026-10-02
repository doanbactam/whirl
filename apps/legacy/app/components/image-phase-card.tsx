import { motion } from "motion/react";

import {
  IMAGE_PLACEHOLDER_SIZE,
  ImageShimmer,
  imageFrameClass,
  MorphingImage,
} from "~/components/generated-image";
import type { Phase } from "~/data/messages";

export type ImagePhase = Extract<Phase, { kind: "image" }>;

/**
 * Whether an image phase renders as an inline picture card: a background
 * paint that's still in flight (pending shimmer) or one whose URLs have
 * landed. Failed paints and legacy rows (picture embedded in the prose as
 * markdown, no `images`) stay a quiet chip instead.
 */
export function isImageCardPhase(phase: Phase): phase is ImagePhase {
  return (
    phase.kind === "image" &&
    (Boolean(phase.pending) || (phase.images?.length ?? 0) > 0)
  );
}

/**
 * The inline card for a background-painted image, right where whirl called
 * the tool: a shimmer square holds the spot while the worker paints (which
 * can outlive the reply stream — the phase updates reactively), then each
 * landed URL blooms in via the same morphing frame the Image tier uses, so
 * pictures feel like one family everywhere in the chat.
 */
export function ImagePhaseCard({
  phase,
  topMargin,
}: {
  phase: ImagePhase;
  topMargin: boolean;
}) {
  const images = phase.images ?? [];
  const painting = Boolean(phase.pending) || images.length === 0;

  return (
    // No `layout` animation — inside the scrolling chat feed it misreads the
    // auto-scroll jump as movement and springs the card around (see the note
    // on MessageBubble's root).
    <motion.div
      initial={{ opacity: 0, y: 4, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{
        opacity: 0,
        y: -4,
        filter: "blur(4px)",
        transition: { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] },
      }}
      transition={{
        opacity: { duration: 0.24, ease: [0.22, 0.61, 0.36, 1] },
        filter: { duration: 0.26, ease: [0.22, 0.61, 0.36, 1] },
        default: { type: "spring", stiffness: 420, damping: 28 },
      }}
      className={`flex max-w-[85%] min-w-0 flex-wrap gap-1.5 ${
        topMargin ? "mt-1.5" : ""
      } mb-0.5`}
    >
      {painting ? (
        <div
          className={imageFrameClass}
          style={{
            width: IMAGE_PLACEHOLDER_SIZE,
            height: IMAGE_PLACEHOLDER_SIZE,
          }}
        >
          <ImageShimmer label="Painting an image" />
        </div>
      ) : (
        images.map((url, index) => (
          <MorphingImage
            key={url}
            attachment={{
              id: url,
              name:
                images.length > 1
                  ? `whirl-painting-${index + 1}.png`
                  : "whirl-painting.png",
              size: 0,
              type: "image/png",
              url,
            }}
          />
        ))
      )}
    </motion.div>
  );
}
