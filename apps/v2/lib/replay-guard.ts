"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

/* Turning session replay off over surfaces that must never be recorded.

   Replay captures the DOM, so anything on screen is on the recording —
   which for a locked chat is the whole point of the lock, undone. The
   password being typed, the recovery key shown once, and every decrypted
   message would all be sitting in a replay we can play back at will. The
   lock has to reach the recorder too, not just the database.

   Reference-counted, because more than one surface can want it off at the
   same time (a locked thread open with the change-password dialog over it),
   and the last one to leave must not turn recording back on while the first
   is still up. Holds are opaque tokens, so two callers can never collide on
   a shared name.

   Replay is only ever *resumed* if this guard is what stopped it. A user who
   had recording off — opted out, no project token, sampled out of the
   session — stays off. */

const holds = new Set<object>();

/** Whether releasing the last hold should turn recording back on. False
 *  when recording wasn't running in the first place. */
let resumeOnRelease = false;

function recordingIsRunning(): boolean {
  try {
    return posthog.__loaded === true && posthog.sessionRecordingStarted();
  } catch {
    return false;
  }
}

function stop() {
  resumeOnRelease = recordingIsRunning();
  if (!resumeOnRelease) return;
  try {
    posthog.stopSessionRecording();
  } catch {
    // Analytics must never be the reason a surface fails to render. The
    // masking in the markup is the backstop for exactly this.
  }
}

function resume() {
  if (!resumeOnRelease) return;
  resumeOnRelease = false;
  try {
    posthog.startSessionRecording();
  } catch {
    // Recording stays off for the rest of the session. The safe direction.
  }
}

/**
 * Hold session replay off until the returned function is called. Safe to
 * call when replay is already suppressed, or when it was never running.
 */
export function suppressReplay(): () => void {
  const hold = {};
  holds.add(hold);
  if (holds.size === 1) stop();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds.delete(hold);
    if (holds.size === 0) resume();
  };
}

/**
 * Hold replay off for as long as `active` is true and this component is
 * mounted. Releases on unmount, which is what makes it safe on a surface
 * that can disappear mid-flight (a thread swap, a dialog dismissed).
 */
export function useSuppressReplay(active: boolean) {
  useEffect(() => {
    if (!active) return;
    return suppressReplay();
  }, [active]);
}

/**
 * Censors an element's text in session replay and keeps it out of
 * autocapture, while leaving the layout intact — a masked transcript still
 * reads as a conversation, just with the words replaced. Every chat thread
 * in the app wears this, locked or not: replay exists to show us broken UI,
 * and it has never needed to know what anyone said.
 *
 * Two classes because PostHog splits the job. `ph-mask` is rrweb's text
 * mask (its `maskTextClass` default, applied to the element and everything
 * under it). `ph-sensitive` is what autocapture checks before reading the
 * text of a clicked element — replay masking alone would still let a click
 * on a message ship its contents as an event property.
 */
export const MASK_TEXT = "ph-mask ph-sensitive";

/**
 * Removes an element from the recording outright — a grey block, not masked
 * text — and from autocapture with it. Stronger and blunter than
 * `MASK_TEXT`, for the handful of places where even the shape of the thing
 * is worth hiding: a locked chat's decrypted transcript, the password
 * fields, the recovery key.
 *
 * Belt and braces next to `useSuppressReplay`. That hook is what actually
 * stops the recorder; this is what covers the frame where something starts
 * it anyway.
 */
export const NO_CAPTURE = "ph-no-capture";
