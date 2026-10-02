import { IconPlus, IconTrash } from "@tabler/icons-react";

import { FieldLabel } from "~/pages/integrations/branding-fields";
import type { AuthMode } from "~/lib/backend";

/** An auth field in the form, with an ephemeral test value used only to scan. */
export type AuthFieldDraft = {
  key: string;
  label: string;
  testValue: string;
};

export const inputClass =
  "h-9 w-full rounded-lg border border-black/[0.08] bg-white px-3 text-[13px] text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-[#0c82f2] focus:ring-2 focus:ring-[#0c82f2]/20 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:placeholder:text-neutral-500";

export const textareaClass =
  "w-full resize-none rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-[13px] text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-[#0c82f2] focus:ring-2 focus:ring-[#0c82f2]/20 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:placeholder:text-neutral-500";

const MAX_AUTH_FIELDS = 5;

/**
 * How users authenticate when installing from the store. OAuth handles
 * itself; API key mode makes the developer define the exact inputs (usually
 * one) and write instructions, so installing is "paste the key, done".
 */
export function AuthConfigFields({
  mode,
  onModeChange,
  fields,
  onFieldsChange,
  instructions,
  onInstructionsChange,
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  fields: AuthFieldDraft[];
  onFieldsChange: (fields: AuthFieldDraft[]) => void;
  instructions: string;
  onInstructionsChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel label="Authentication" />
        <div className="grid grid-cols-3 gap-2">
          <ModeOption
            selected={mode === "none"}
            onSelect={() => onModeChange("none")}
            title="None"
            body="The server is open — no credentials needed."
          />
          <ModeOption
            selected={mode === "oauth"}
            onSelect={() => onModeChange("oauth")}
            title="OAuth"
            body="Users sign in via the server's OAuth flow."
          />
          <ModeOption
            selected={mode === "apiKey"}
            onSelect={() => onModeChange("apiKey")}
            title="API key"
            body="Users paste a key into the fields you define."
          />
        </div>
      </div>

      {mode === "apiKey" && (
        <>
          <div className="flex flex-col gap-1.5">
            <FieldLabel label="Fields users fill in" />
            <p className="text-[11.5px] leading-snug text-neutral-400 dark:text-neutral-500">
              Keep it to one field if you can — the label is what users see,
              the header is where their value gets sent. The test value is
              only used for scanning tools below and is never stored.
            </p>
            <div className="mt-1 flex flex-col gap-2">
              {fields.map((field, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={field.label}
                    onChange={(e) =>
                      onFieldsChange(
                        fields.map((f, j) =>
                          j === i ? { ...f, label: e.target.value } : f,
                        ),
                      )
                    }
                    placeholder="Label, e.g. API Key"
                    className={inputClass}
                  />
                  <input
                    value={field.key}
                    onChange={(e) =>
                      onFieldsChange(
                        fields.map((f, j) =>
                          j === i ? { ...f, key: e.target.value } : f,
                        ),
                      )
                    }
                    placeholder="Header, e.g. Authorization"
                    className={`${inputClass} font-mono text-[12px]`}
                  />
                  <input
                    value={field.testValue}
                    onChange={(e) =>
                      onFieldsChange(
                        fields.map((f, j) =>
                          j === i ? { ...f, testValue: e.target.value } : f,
                        ),
                      )
                    }
                    type="password"
                    placeholder="Test value (for scanning)"
                    className={inputClass}
                  />
                  {fields.length > 1 && (
                    <button
                      type="button"
                      aria-label="Remove field"
                      onClick={() =>
                        onFieldsChange(fields.filter((_, j) => j !== i))
                      }
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-black/[0.05] hover:text-red-600 dark:hover:bg-white/[0.07] dark:hover:text-red-400"
                    >
                      <IconTrash size={14} stroke={2} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {fields.length < MAX_AUTH_FIELDS && (
              <button
                type="button"
                onClick={() =>
                  onFieldsChange([
                    ...fields,
                    { key: "", label: "", testValue: "" },
                  ])
                }
                className="mt-1 inline-flex w-fit items-center gap-1.5 text-[12px] font-medium text-[#0c82f2] transition-opacity hover:opacity-80"
              >
                <IconPlus size={13} stroke={2.5} />
                Add another field
              </button>
            )}
          </div>

          <label className="flex flex-col gap-1.5">
            <FieldLabel label="Instructions for users" />
            <textarea
              value={instructions}
              onChange={(e) => onInstructionsChange(e.target.value)}
              placeholder={
                "Where do users get their key? e.g. \"Go to dashboard.example.com → Settings → API Keys, create a key, and paste it here.\""
              }
              maxLength={2000}
              rows={3}
              className={textareaClass}
            />
          </label>
        </>
      )}
    </div>
  );
}

function ModeOption({
  selected,
  onSelect,
  title,
  body,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition ${
        selected
          ? "border-[#0c82f2] bg-[#0c82f2]/[0.05] ring-1 ring-[#0c82f2] dark:bg-[#3b9bff]/[0.08]"
          : "border-black/[0.08] hover:border-black/[0.16] dark:border-white/[0.1] dark:hover:border-white/[0.2]"
      }`}
    >
      <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
        {title}
      </span>
      <span className="text-[11.5px] leading-snug text-neutral-500 dark:text-neutral-400">
        {body}
      </span>
    </button>
  );
}
