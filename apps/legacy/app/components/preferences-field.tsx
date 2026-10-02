import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/tanstack-react-start";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";

import { showToast } from "~/data/toasts";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

const getPreferencesRef = makeFunctionReference<"query">(
  "preferences:getPreferences",
);
const setPreferencesRef = makeFunctionReference<"mutation">(
  "preferences:setPreferences",
);

const MAX_PREFERENCES_LENGTH = 2000;

/**
 * Free-text "tell the AI about yourself" field. Saves on blur; the text is
 * injected into the model's system prompt as explicit user preferences.
 */
export function PreferencesField() {
  const { isSignedIn } = useUser();
  const stored = useQuery(getPreferencesRef, isSignedIn ? {} : "skip") as
    | { text: string; updatedAt: number }
    | null
    | undefined;
  const save = useMutation(setPreferencesRef);
  const capture = useCapture();

  const [text, setText] = useState<string | null>(null);
  const savingRef = useRef(false);

  // Seed local state once the stored value loads; never clobber in-progress edits.
  useEffect(() => {
    if (text === null && stored !== undefined) {
      setText(stored?.text ?? "");
    }
  }, [stored, text]);

  if (!isSignedIn) return null;

  const commit = async () => {
    if (text === null || savingRef.current) return;
    const trimmed = text.trim();
    if (trimmed === (stored?.text ?? "")) return;

    savingRef.current = true;
    try {
      await save({ text: trimmed });
      capture(ANALYTICS_EVENTS.preferencesSaved, {
        length: trimmed.length,
        cleared: trimmed.length === 0,
      });
    } catch {
      showToast({
        message: "Couldn't save your preferences. Try again.",
        tone: "danger",
      });
    } finally {
      savingRef.current = false;
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b border-black/[0.04] py-3.5 last:border-b-0 dark:border-white/[0.05]">
      <div className="flex flex-col">
        <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
          Your preferences
        </span>
        <span className="mt-0.5 text-[12px] text-neutral-500 dark:text-neutral-400">
          Anything Whirl should know about you — tone, interests, how you like
          answers. Applied to every conversation.
        </span>
      </div>
      <textarea
        value={text ?? ""}
        onChange={(e) =>
          setText(e.target.value.slice(0, MAX_PREFERENCES_LENGTH))
        }
        onBlur={() => void commit()}
        disabled={text === null}
        rows={5}
        maxLength={MAX_PREFERENCES_LENGTH}
        placeholder="e.g. I'm a med student, keep explanations short, no emojis please"
        className="w-full resize-y rounded-lg border border-black/[0.08] bg-white px-3 py-2.5 text-[13px] leading-relaxed text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:bg-black/[0.03] focus-visible:border-black/20 disabled:opacity-60 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:hover:bg-white/[0.04] dark:focus-visible:border-white/30"
      />
      {text !== null && text.length >= MAX_PREFERENCES_LENGTH - 200 && (
        <span className="self-end text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
          {text.length} / {MAX_PREFERENCES_LENGTH}
        </span>
      )}
    </div>
  );
}
