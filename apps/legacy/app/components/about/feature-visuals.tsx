import {
  IconBoltFilled,
  IconBrandGmail,
  IconBrandNotion,
  IconCalendarFilled,
  IconPlus,
  IconPuzzleFilled,
  IconSparklesFilled,
} from "@tabler/icons-react";

import { VISUAL_CARD_CLASS as CARD_CLASS } from "~/components/about/visual-card";

/**
 * Hand-built illustrations for the /about feature sections. No screenshots,
 * just tiny mocks in the site's own visual language, so they stay crisp at
 * any size and honest in both themes.
 */

/** A two-beat chat mock: something said once, remembered weeks later. */
export function MemoryVisual() {
  return (
    <div aria-hidden className={CARD_CLASS}>
      <div className="flex flex-col gap-3 text-[13px] leading-snug">
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[#0C82F2] px-3.5 py-2 text-white">
          I'm training for the SF half marathon in March
        </div>
        <div className="flex items-center gap-3 py-1 text-[11px] text-neutral-400 dark:text-neutral-500">
          <span className="h-px flex-1 bg-black/[0.07] dark:bg-white/[0.08]" />
          two weeks later
          <span className="h-px flex-1 bg-black/[0.07] dark:bg-white/[0.08]" />
        </div>
        <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-md bg-black/[0.04] px-3.5 py-2 text-neutral-800 dark:bg-white/[0.06] dark:text-neutral-200">
          Week 3 of your half plan calls for an easy 5k today. How did
          Sunday's long run go?
        </div>
      </div>
    </div>
  );
}

/** A mini living-artifact card: skeleton prose plus a climbing bar chart. */
export function ArtifactVisual() {
  const bars = [32, 44, 38, 56, 62, 74, 88];
  return (
    <div aria-hidden className={CARD_CLASS}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
          training-plan
        </span>
        <span className="rounded-full bg-[#0C82F2]/10 px-2 py-0.5 text-[10px] font-medium text-[#0C82F2]">
          editable
        </span>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <span className="h-2 w-4/5 rounded-full bg-black/[0.06] dark:bg-white/[0.08]" />
        <span className="h-2 w-full rounded-full bg-black/[0.06] dark:bg-white/[0.08]" />
        <span className="h-2 w-3/5 rounded-full bg-black/[0.06] dark:bg-white/[0.08]" />
      </div>
      <div className="mt-5 flex h-24 items-end gap-1.5">
        {bars.map((h, i) => (
          <span
            key={i}
            style={{ height: `${h}%` }}
            className={`flex-1 rounded-t-md ${
              i === bars.length - 1 ? "bg-[#0C82F2]" : "bg-[#0C82F2]/30"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

const INTEGRATION_TILES = [
  { icon: IconBrandGmail, label: "Gmail", tint: "text-[#EA4335]" },
  { icon: IconCalendarFilled, label: "Google Calendar", tint: "text-[#4285F4]" },
  {
    icon: IconBrandNotion,
    label: "Notion",
    tint: "text-neutral-800 dark:text-neutral-200",
  },
  { icon: IconPuzzleFilled, label: "Hundreds more", tint: "text-[#0C82F2]" },
] as const;

/** A 2x2 of connected apps, the last tile hinting at the community catalog. */
export function IntegrationsVisual() {
  return (
    <div aria-hidden className={CARD_CLASS}>
      <div className="grid grid-cols-2 gap-3">
        {INTEGRATION_TILES.map(({ icon: Icon, label, tint }) => (
          <div
            key={label}
            className="flex flex-col items-start gap-2 rounded-2xl bg-black/[0.03] p-4 dark:bg-white/[0.04]"
          >
            <Icon size={22} className={tint} />
            <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SKILL_ROWS = [
  { icon: IconSparklesFilled, name: "Deep Research", detail: "Multi-source reports" },
  { icon: IconCalendarFilled, name: "Daily Briefing", detail: "Your morning, summarized" },
  { icon: IconBoltFilled, name: "Meeting Prep", detail: "Context before every call" },
] as const;

/** A short list of installed skills with a ghost row inviting one more. */
export function SkillsVisual() {
  return (
    <div aria-hidden className={CARD_CLASS}>
      <div className="flex flex-col gap-2">
        {SKILL_ROWS.map(({ icon: Icon, name, detail }) => (
          <div
            key={name}
            className="flex items-center gap-3 rounded-2xl bg-black/[0.03] px-4 py-3 dark:bg-white/[0.04]"
          >
            <Icon size={18} className="text-[#0C82F2]" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-neutral-800 dark:text-neutral-200">
                {name}
              </div>
              <div className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
                {detail}
              </div>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-black/[0.12] px-4 py-3 text-neutral-400 dark:border-white/[0.14] dark:text-neutral-500">
          <IconPlus size={18} />
          <span className="text-[13px] font-medium">Teach it something new</span>
        </div>
      </div>
    </div>
  );
}
