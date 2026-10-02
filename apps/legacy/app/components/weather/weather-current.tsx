import { IconDroplet, IconWind } from "@tabler/icons-react";

import { WeatherIcon, weatherLabel } from "./weather-icon";
import { roundTemp } from "./weather-format";

/** The hero row: big icon + temperature, condition label, and a few stats. */
export function WeatherCurrent({
  temp,
  apparentTemp,
  code,
  isDay,
  humidity,
  windSpeed,
  high,
  low,
  tempUnit,
  windUnit,
}: {
  temp: number;
  apparentTemp?: number;
  code: number;
  isDay: boolean;
  humidity?: number;
  windSpeed?: number;
  high?: number;
  low?: number;
  tempUnit: "C" | "F";
  windUnit: "km/h" | "mph";
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        <WeatherIcon
          code={code}
          isDay={isDay}
          size={48}
          className="text-neutral-700 dark:text-neutral-200"
        />
        <div className="flex flex-col">
          <div className="flex items-start leading-none">
            <span className="text-4xl font-semibold tracking-tight text-neutral-900 tabular-nums dark:text-neutral-50">
              {roundTemp(temp)}
            </span>
            <span className="mt-0.5 text-lg font-medium text-neutral-500 dark:text-neutral-400">
              °{tempUnit}
            </span>
          </div>
          <span className="mt-1 text-sm capitalize text-neutral-600 dark:text-neutral-300">
            {weatherLabel(code)}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1 pt-0.5 text-right">
        {(high !== undefined || low !== undefined) && (
          <div className="text-sm tabular-nums text-neutral-600 dark:text-neutral-300">
            {high !== undefined && (
              <span className="font-medium text-neutral-800 dark:text-neutral-100">
                {roundTemp(high)}°
              </span>
            )}
            {low !== undefined && (
              <span className="ml-1.5 text-neutral-400 dark:text-neutral-500">
                {roundTemp(low)}°
              </span>
            )}
          </div>
        )}
        {apparentTemp !== undefined && (
          <span className="text-xs text-neutral-400 dark:text-neutral-500">
            feels like {roundTemp(apparentTemp)}°
          </span>
        )}
        <div className="mt-0.5 flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
          {humidity !== undefined && (
            <span className="flex items-center gap-1">
              <IconDroplet size={13} stroke={2} />
              <span className="tabular-nums">{humidity}%</span>
            </span>
          )}
          {windSpeed !== undefined && (
            <span className="flex items-center gap-1">
              <IconWind size={13} stroke={2} />
              <span className="tabular-nums">
                {Math.round(windSpeed)} {windUnit}
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
