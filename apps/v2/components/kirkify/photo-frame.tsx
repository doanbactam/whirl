"use client";

import type { Ref } from "react";

import {
  GeneratingBeam,
  imageFrameClass,
} from "@/components/thread/generated-image";
import type { PreparedPhoto } from "@/lib/kirkify/prepare-photo";

/**
 * The chosen photo, sized by CSS alone: its own aspect ratio, as wide as
 * the stage allows, never taller than `maxHeight`. While the swap runs the
 * same frame dims, blurs a touch, and takes the thread's generating beam,
 * so the result can land in a box that's already the right size.
 */
export function PhotoFrame({
  ref,
  photo,
  working,
  maxHeight,
}: {
  ref?: Ref<HTMLDivElement>;
  photo: PreparedPhoto;
  working: boolean;
  maxHeight: number;
}) {
  const widthAtMaxHeight = Math.round((maxHeight * photo.width) / photo.height);
  const frame = (
    <div
      ref={ref}
      className={`${imageFrameClass} max-w-full`}
      style={{
        aspectRatio: `${photo.width} / ${photo.height}`,
        width: `min(100cqw, ${widthAtMaxHeight}px)`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.dataUrl}
        alt=""
        draggable={false}
        className={`absolute inset-0 h-full w-full object-cover transition-[opacity,filter] duration-300 ${
          working ? "opacity-40 blur-[2px]" : ""
        }`}
      />
      {working && (
        <div
          role="status"
          aria-label="Kirkifying"
          className="absolute inset-0 flex flex-col items-center justify-center gap-1"
        >
          <span className="text-shimmer text-[14px]/5 font-medium [--shimmer-dur:1600ms]">
            Kirkifying...
          </span>
          <span className="text-[12px]/4 text-neutral-500 dark:text-neutral-400">
            Usually under a minute
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className="@container flex justify-center">
      {working ? <GeneratingBeam radius={16}>{frame}</GeneratingBeam> : frame}
    </div>
  );
}
