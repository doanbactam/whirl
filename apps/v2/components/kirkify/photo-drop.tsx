"use client";

import { useState } from "react";

import { ReferenceFan } from "./reference-fan";

/**
 * The empty stage: a target for a dropped file, and a button for the
 * picker. The children ignore the pointer so a drag crossing them doesn't
 * fire dragleave and flicker the highlight.
 */
export function PhotoDrop({
  onBrowse,
  onFile,
}: {
  onBrowse: () => void;
  onFile: (file: File) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <button
      type="button"
      onClick={onBrowse}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const file = event.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      className={`flex min-h-[380px] w-full cursor-pointer flex-col items-center justify-center gap-5 rounded-2xl border border-dashed px-6 text-center transition-colors duration-150 [&>*]:pointer-events-none ${
        over
          ? "border-[#0c82f2] bg-[#0c82f2]/5"
          : "border-black/12 hover:bg-black/[0.025] dark:border-white/14 dark:hover:bg-white/[0.035]"
      }`}
    >
      <ReferenceFan />
      <div>
        <p className="text-[15px] font-medium text-neutral-900 dark:text-neutral-50">
          Drop a photo here
        </p>
        <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
          Or click to choose one. Pasting works too. JPG, PNG or WebP, up to 12
          MB.
        </p>
      </div>
    </button>
  );
}
