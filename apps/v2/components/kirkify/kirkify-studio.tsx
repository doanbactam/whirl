"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  IconAlertCircleFilled,
  IconArrowsExchange,
  IconDownload,
  IconRefresh,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { CtaButton } from "@/components/marketing/page-blocks";
import { MorphHeight } from "@/components/morph-height";
import { MorphingImage } from "@/components/thread/generated-image";
import { Spinner } from "@/components/ui/spinner";
import { KirkifyError, requestKirkify } from "@/lib/kirkify/client";
import {
  PhotoError,
  preparePhoto,
  type PreparedPhoto,
} from "@/lib/kirkify/prepare-photo";
import { useKirkifyQuota } from "@/lib/kirkify/use-kirkify-quota";
import { EASE_OUT } from "@/lib/motion";

import { PhotoDrop } from "./photo-drop";
import { PhotoFrame } from "./photo-frame";
import { QuotaLine } from "./quota-line";

/* Clerk's panels are heavy and most visitors never open them. */
const AuthModal = dynamic(
  () => import("@/components/auth/auth-modal").then((m) => m.AuthModal),
  { ssr: false },
);

type Stage =
  | { kind: "empty" }
  | { kind: "ready"; photo: PreparedPhoto }
  | { kind: "working"; photo: PreparedPhoto }
  | {
      kind: "done";
      photo: PreparedPhoto;
      image: string;
      /* The frame's on-screen size the moment the swap landed, so the
         result opens in a box that's already the right size. */
      frame: { width: number; height: number };
      maxWidth: number;
    };

const STAGE_MAX_HEIGHT = 560;
const DOWNLOAD_NAME = "kirkified.jpg";

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2, ease: EASE_OUT },
} as const;

async function downloadDataUrl(dataUrl: string, name: string) {
  /* Through an object URL: Safari opens a data: href in a tab rather than
     honouring the download attribute. */
  const blob = await (await fetch(dataUrl)).blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export function KirkifyStudio() {
  const [stage, setStage] = useState<Stage>({ kind: "empty" });
  const [notice, setNotice] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const { quota, apply: applyRemaining } = useKirkifyQuota();

  const inputRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  /* A swap outliving the page must not write into it. */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const working = stage.kind === "working";
  const outOfSlots = quota !== null && !quota.paid && quota.remaining.total === 0;

  const pick = useCallback(async (file: File) => {
    setNotice(null);
    try {
      const photo = await preparePhoto(file);
      if (mounted.current) setStage({ kind: "ready", photo });
    } catch (error) {
      if (!mounted.current) return;
      setNotice(
        error instanceof PhotoError
          ? error.message
          : "Couldn't read that image.",
      );
    }
  }, []);

  /* Paste a picture anywhere on the page. Off while a swap runs, so a
     stray paste can't swap the photo out from under it. */
  useEffect(() => {
    if (working) return;
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((item) =>
        item.type.startsWith("image/"),
      );
      if (!file) return;
      event.preventDefault();
      void pick(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [working, pick]);

  const browse = () => inputRef.current?.click();

  const reset = () => {
    setStage({ kind: "empty" });
    setNotice(null);
  };

  const run = async () => {
    if (stage.kind !== "ready") return;
    const { photo } = stage;
    setNotice(null);
    setStage({ kind: "working", photo });
    try {
      const result = await requestKirkify(photo);
      if (!mounted.current) return;
      const rect = frameRef.current?.getBoundingClientRect();
      const frame = rect
        ? { width: Math.round(rect.width), height: Math.round(rect.height) }
        : { width: photo.width, height: photo.height };
      const maxWidth = bodyRef.current?.clientWidth ?? frame.width;
      applyRemaining(result.remaining);
      setStage({ kind: "done", photo, image: result.image, frame, maxWidth });
    } catch (error) {
      if (!mounted.current) return;
      setStage({ kind: "ready", photo });
      if (error instanceof KirkifyError) {
        if (error.remaining) applyRemaining(error.remaining);
        setNotice(error.message);
      } else {
        setNotice("Something went wrong on our side. Try again in a moment.");
      }
    }
  };

  const download = () => {
    if (stage.kind !== "done") return;
    downloadDataUrl(stage.image, DOWNLOAD_NAME).catch(() =>
      setNotice("Couldn't download the picture."),
    );
  };

  return (
    <section className="mt-10">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          /* Reset so choosing the same file again still fires a change. */
          event.currentTarget.value = "";
          if (file) void pick(file);
        }}
      />

      <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-black/7 dark:bg-[#161615] dark:ring-white/8">
        <div ref={bodyRef} className="p-3 sm:p-4">
          <MorphHeight>
            <AnimatePresence mode="popLayout" initial={false}>
              {stage.kind === "empty" && (
                <motion.div key="empty" {...fade}>
                  <PhotoDrop onBrowse={browse} onFile={pick} />
                </motion.div>
              )}
              {(stage.kind === "ready" || stage.kind === "working") && (
                <motion.div key="photo" {...fade}>
                  <PhotoFrame
                    ref={frameRef}
                    photo={stage.photo}
                    working={working}
                    maxHeight={STAGE_MAX_HEIGHT}
                  />
                </motion.div>
              )}
              {stage.kind === "done" && (
                <motion.div key="done" {...fade} className="flex justify-center">
                  <MorphingImage
                    src={stage.image}
                    alt="Kirkified photo"
                    downloadName={DOWNLOAD_NAME}
                    initialSize={stage.frame}
                    maxWidth={stage.maxWidth}
                    maxHeight={STAGE_MAX_HEIGHT}
                    className="max-w-full"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </MorphHeight>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/7 px-4 py-3 dark:border-white/8">
          <QuotaLine quota={quota} onSignIn={() => setAuthOpen(true)} />
          <div className="flex items-center gap-2">
            {stage.kind === "ready" && (
              <>
                <CtaButton onClick={browse}>Change photo</CtaButton>
                <CtaButton primary onClick={run} disabled={outOfSlots}>
                  <IconArrowsExchange size={15} stroke={2.25} />
                  Kirkify it
                </CtaButton>
              </>
            )}
            {working && (
              <CtaButton primary disabled>
                <Spinner />
                Kirkifying...
              </CtaButton>
            )}
            {stage.kind === "done" && (
              <>
                <CtaButton onClick={reset}>
                  <IconRefresh size={15} stroke={2.25} />
                  Kirkify another
                </CtaButton>
                <CtaButton primary onClick={download}>
                  <IconDownload size={15} stroke={2.25} />
                  Download
                </CtaButton>
              </>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {notice && (
          <motion.p
            key={notice}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="mt-3 flex items-start gap-2 text-[13.5px] leading-relaxed text-destructive"
          >
            <IconAlertCircleFilled size={16} className="mt-0.5 shrink-0" />
            {notice}
          </motion.p>
        )}
      </AnimatePresence>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </section>
  );
}
