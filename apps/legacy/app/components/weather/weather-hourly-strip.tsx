import type { WeatherHour } from "~/data/messages";

import { WeatherIcon } from "./weather-icon";
import { formatHour, roundTemp } from "./weather-format";

/** A horizontally-scrolling strip of the next ~24 hours. */
export function WeatherHourlyStrip({
  hours,
  isDay,
}: {
  hours: WeatherHour[];
  isDay: boolean;
}) {
  if (hours.length === 0) return null;

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex gap-1">
        {hours.map((hour, i) => (
          <div
            key={hour.time}
            className="flex min-w-[3.25rem] flex-col items-center gap-1.5 rounded-xl px-2 py-2"
          >
            <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
              {i === 0 ? "Now" : formatHour(hour.time)}
            </span>
            <WeatherIcon
              code={hour.code}
              isDay={isDay}
              size={20}
              className="text-neutral-600 dark:text-neutral-300"
            />
            {hour.precipProb !== undefined && hour.precipProb > 0 ? (
              <span className="text-[10px] tabular-nums text-sky-500 dark:text-sky-400">
                {hour.precipProb}%
              </span>
            ) : (
              <span className="text-[10px] text-transparent">·</span>
            )}
            <span className="text-xs font-medium tabular-nums text-neutral-800 dark:text-neutral-100">
              {roundTemp(hour.temp)}°
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
