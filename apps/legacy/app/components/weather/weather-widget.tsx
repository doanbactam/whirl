import { useEffect, useMemo, useState } from "react";
import { IconCheck, IconCloudOff, IconMapPin } from "@tabler/icons-react";
import { motion, AnimatePresence } from "motion/react";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";

import type { Phase, WeatherDay, WeatherHour } from "~/data/messages";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";
import {
  convertTemp,
  convertWind,
  resolveWeatherUnits,
  useUnitsPref,
} from "~/lib/units";
import { WIDGET_ENTRANCE } from "~/components/widget-entrance";

import { WeatherCurrent } from "./weather-current";
import { WeatherDailyList } from "./weather-daily-list";
import { WeatherHourlyStrip } from "./weather-hourly-strip";

type WeatherPhase = Extract<Phase, { kind: "weather" }>;

const reportPreciseLocationRef = makeFunctionReference<"mutation">(
  "userContext:reportPreciseLocation",
);

const CARD_SURFACE =
  "rounded-2xl border border-black/[0.06] bg-white/60 shadow-[0_1px_2px_rgba(0,0,0,0.03)] backdrop-blur-sm dark:border-white/[0.06] dark:bg-white/[0.03]";

const DIVIDER = "h-px w-full bg-black/[0.06] dark:bg-white/[0.06]";

function convertHourly(
  hours: WeatherHour[],
  from: "C" | "F",
  to: "C" | "F",
): WeatherHour[] {
  if (from === to) return hours;
  return hours.map((hour) => ({
    ...hour,
    temp: convertTemp(hour.temp, from, to),
  }));
}

function convertDaily(
  days: WeatherDay[],
  from: "C" | "F",
  to: "C" | "F",
): WeatherDay[] {
  if (from === to) return days;
  return days.map((day) => ({
    ...day,
    max: convertTemp(day.max, from, to),
    min: convertTemp(day.min, from, to),
  }));
}

/** A subtle "use my exact location" affordance, shown only on coarse guesses. */
function PreciseLocationPill() {
  const reportPrecise = useMutation(reportPreciseLocationRef);
  const capture = useCapture();
  const [saved, setSaved] = useState(false);

  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  if (saved) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <IconCheck size={12} stroke={2.5} />
        precise next time
      </span>
    );
  }

  const onClick = () => {
    capture(ANALYTICS_EVENTS.weatherPreciseLocationRequested, {});
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void reportPrecise({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
          .then(() => setSaved(true))
          .catch(() => {});
      },
      () => {
        // User declined or it failed — leave the pill as-is, no nagging.
      },
      { timeout: 8000 },
    );
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
    >
      <IconMapPin size={12} stroke={2} />
      use exact location
    </button>
  );
}

export function WeatherWidget({
  phase,
  animate,
}: {
  phase: WeatherPhase;
  animate: boolean;
}) {
  const capture = useCapture();
  const unitsPref = useUnitsPref();
  const locale =
    typeof navigator !== "undefined" ? navigator.language : undefined;
  const displayUnits = resolveWeatherUnits(unitsPref, locale);
  const storedTempUnit = phase.tempUnit ?? "C";
  const storedWindUnit = phase.windUnit ?? "km/h";

  const display = useMemo(() => {
    if (phase.temp === undefined || phase.code === undefined) return null;
    const today = phase.daily?.[0];
    return {
      code: phase.code,
      temp: convertTemp(phase.temp, storedTempUnit, displayUnits.temp),
      apparentTemp:
        phase.apparentTemp !== undefined
          ? convertTemp(phase.apparentTemp, storedTempUnit, displayUnits.temp)
          : undefined,
      windSpeed:
        phase.windSpeed !== undefined
          ? convertWind(phase.windSpeed, storedWindUnit, displayUnits.wind)
          : undefined,
      high:
        today?.max !== undefined
          ? convertTemp(today.max, storedTempUnit, displayUnits.temp)
          : undefined,
      low:
        today?.min !== undefined
          ? convertTemp(today.min, storedTempUnit, displayUnits.temp)
          : undefined,
      hourly: phase.hourly
        ? convertHourly(phase.hourly, storedTempUnit, displayUnits.temp)
        : undefined,
      daily: phase.daily
        ? convertDaily(phase.daily, storedTempUnit, displayUnits.temp)
        : undefined,
    };
  }, [displayUnits, phase, storedTempUnit, storedWindUnit]);

  useEffect(() => {
    if (phase.error) return;
    capture(ANALYTICS_EVENTS.weatherWidgetShown, {
      approximate: phase.approximate ?? false,
    });
    // Fire once per rendered widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase.error) {
    return (
      <div className="mt-1 flex items-center gap-2 text-[15px] text-neutral-500 dark:text-neutral-400">
        <IconCloudOff size={16} stroke={2} />
        {phase.error}
      </div>
    );
  }

  return (
    <AnimatePresence>
      {display ? (
        <motion.div
          key="weather-card"
          initial={animate ? WIDGET_ENTRANCE.initial : false}
          animate={WIDGET_ENTRANCE.animate}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={WIDGET_ENTRANCE.transition}
          className={`mt-1.5 w-full max-w-[26rem] overflow-hidden p-4 ${CARD_SURFACE}`}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-neutral-700 dark:text-neutral-200">
              {phase.place ?? "Weather"}
            </span>
            {phase.approximate ? (
              <PreciseLocationPill />
            ) : (
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                now
              </span>
            )}
          </div>

          <WeatherCurrent
            temp={display.temp}
            apparentTemp={display.apparentTemp}
            code={display.code}
            isDay={phase.isDay ?? true}
            humidity={phase.humidity}
            windSpeed={display.windSpeed}
            high={display.high}
            low={display.low}
            tempUnit={displayUnits.temp}
            windUnit={displayUnits.wind}
          />

          {display.hourly && display.hourly.length > 0 && (
            <>
              <div className={`my-3 ${DIVIDER}`} />
              <WeatherHourlyStrip
                hours={display.hourly}
                isDay={phase.isDay ?? true}
              />
            </>
          )}

          {display.daily && display.daily.length > 1 && (
            <>
              <div className={`my-3 ${DIVIDER}`} />
              <WeatherDailyList
                days={display.daily}
                timezone={phase.timezone ?? "UTC"}
              />
            </>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
