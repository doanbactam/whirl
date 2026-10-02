import {
  IconChevronRight,
  IconMessageCircle,
  IconMoon,
  IconSettings,
} from "@tabler/icons-react";

// Ripped from apps/legacy: dropdown-menu.tsx shell classes + the UsageBlock and
// compact menu rows in __root.tsx, light mode only. Keep in sync by eye.
const shellClass =
  "cursor-default select-none rounded-xl border border-black/[0.08] bg-white p-1 shadow-[0_8px_24px_rgba(0,0,0,0.08),_0_2px_4px_rgba(0,0,0,0.04)]";
const itemClass =
  "flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] text-neutral-700";

const BAR_WIDTH = 3;
export const BAR_COUNT = 36;
export const MENU_WIDTH = 280;

// 100% remaining, so every bar is filled — emerald until the boost hits.
const EMERALD_500 = "#10b981";

export function UserMenu({
  percent,
  barBoosts,
  hueBase,
}: {
  percent: number;
  /** Per-bar 0..1 — how far each bar has turned rainbow. */
  barBoosts: number[];
  /** Rotating hue offset so the rainbow shimmers while held. */
  hueBase: number;
}) {
  return (
    <div className={shellClass} style={{ width: MENU_WIDTH }}>
      <div className="px-2.5 pb-2 pt-1.5">
        <div className="flex items-start justify-between">
          <span className="text-[13px] font-medium text-neutral-700">
            Usage
          </span>
          <div className="text-right leading-tight">
            <div className="text-[14px] font-semibold tabular-nums text-neutral-900">
              {percent}%
            </div>
            <div className="text-[10px] text-neutral-500">Remaining</div>
          </div>
        </div>
        <div className="mt-2 flex h-5 w-full items-center justify-between">
          {barBoosts.map((boost, i) => {
            const hue = (hueBase + (i / BAR_COUNT) * 360) % 360;
            return (
              <div
                key={i}
                className="relative h-full overflow-hidden rounded-full"
                style={{
                  width: BAR_WIDTH,
                  backgroundColor: EMERALD_500,
                }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundColor: `hsl(${hue} 90% 55%)`,
                    opacity: boost,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-neutral-500">
          <span>Mega</span>
          <span>Resets in 5d 19h</span>
        </div>
      </div>
      <div className="my-1 h-px bg-black/[0.06]" />
      <div className={itemClass}>
        <IconMoon size={14} stroke={2} />
        <span className="flex-1">Theme</span>
        <IconChevronRight size={14} stroke={2} className="text-neutral-500" />
      </div>
      <div className={itemClass}>
        <IconSettings size={14} stroke={2} />
        Settings
      </div>
      <div className={itemClass}>
        <IconMessageCircle size={14} stroke={2} />
        Feedback
      </div>
    </div>
  );
}
