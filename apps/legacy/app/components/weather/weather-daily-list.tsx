import type { WeatherDay } from "~/data/messages";

import { WeatherIcon } from "./weather-icon";
import { formatWeekday, isToday, roundTemp } from "./weather-format";

/** A compact 7-day list with a relative hi/lo temperature bar per row. */
export function WeatherDailyList({
  days,
  timezone,
}: {
  days: WeatherDay[];
  timezone: string;
}) {
  if (days.length === 0) return null;

  // The bar is positioned within the whole week's range so the days read as a
  // single comparable scale.
  const weekMin = Math.min(...days.map((d) => d.min));
  const weekMax = Math.max(...days.map((d) => d.max));
  const span = Math.max(weekMax - weekMin, 1);

  return (
    <div className="flex flex-col">
      {days.map((day, i) => {
        const today = i === 0 || isToday(day.date, timezone);
        const left = ((day.min - weekMin) / span) * 100;
        const width = Math.max(((day.max - day.min) / span) * 100, 6);
        return (
          <div
            key={day.date}
            className="flex items-center gap-3 py-1.5 text-sm"
          >
            <span className="w-10 shrink-0 font-medium text-neutral-700 dark:text-neutral-200">
              {today ? "Today" : formatWeekday(day.date)}
            </span>
            <WeatherIcon
              code={day.code}
              isDay
              size={18}
              className="shrink-0 text-neutral-500 dark:text-neutral-400"
            />
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-sky-500 dark:text-sky-400">
              {day.precipProb !== undefined && day.precipProb > 0
                ? `${day.precipProb}%`
                : ""}
            </span>
            <span className="w-7 shrink-0 text-right text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
              {roundTemp(day.min)}°
            </span>
            <div className="relative h-1.5 flex-1 rounded-full bg-neutral-200/70 dark:bg-neutral-700/60">
              <div
                className="absolute h-full rounded-full bg-gradient-to-r from-sky-400 to-amber-400 dark:from-sky-500 dark:to-amber-400"
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </div>
            <span className="w-7 shrink-0 text-xs font-medium tabular-nums text-neutral-700 dark:text-neutral-200">
              {roundTemp(day.max)}°
            </span>
          </div>
        );
      })}
    </div>
  );
}
