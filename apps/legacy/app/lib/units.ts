import { useEffect, useState } from "react";

import { ANALYTICS_EVENTS, captureEvent } from "~/lib/posthog";

export type UnitsPref = "auto" | "metric" | "imperial";

export type WeatherUnits = {
  temp: "C" | "F";
  wind: "km/h" | "mph";
};

const STORAGE_KEY = "units";

/** Locale-aware default — imperial only for US, Liberia, and Myanmar. */
export function unitsForLocale(locale?: string): WeatherUnits {
  const region = locale?.split("-")[1]?.toUpperCase();
  const imperial = region === "US" || region === "LR" || region === "MM";
  return imperial ? { temp: "F", wind: "mph" } : { temp: "C", wind: "km/h" };
}

export function resolveWeatherUnits(
  pref: UnitsPref,
  locale?: string,
): WeatherUnits {
  if (pref === "imperial") return { temp: "F", wind: "mph" };
  if (pref === "metric") return { temp: "C", wind: "km/h" };
  return unitsForLocale(locale);
}

export function convertTemp(
  value: number,
  from: "C" | "F",
  to: "C" | "F",
): number {
  if (from === to) return value;
  return from === "C" ? (value * 9) / 5 + 32 : ((value - 32) * 5) / 9;
}

export function convertWind(
  value: number,
  from: "km/h" | "mph",
  to: "km/h" | "mph",
): number {
  if (from === to) return value;
  return from === "km/h" ? value * 0.621371 : value / 0.621371;
}

export function setUnitsPref(pref: UnitsPref) {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {}
  window.dispatchEvent(
    new CustomEvent<UnitsPref>("units-change", { detail: pref }),
  );
  captureEvent(ANALYTICS_EVENTS.unitsChanged, { units: pref });
}

export function readUnitsPref(): UnitsPref {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "auto" || value === "metric" || value === "imperial") {
      return value;
    }
  } catch {}
  return "auto";
}

/** Live preference with updates from settings. */
export function useUnitsPref(): UnitsPref {
  const [pref, setPref] = useState<UnitsPref>(() =>
    typeof window === "undefined" ? "auto" : readUnitsPref(),
  );

  useEffect(() => {
    const onChange = (event: Event) => {
      setPref((event as CustomEvent<UnitsPref>).detail);
    };
    window.addEventListener("units-change", onChange);
    return () => window.removeEventListener("units-change", onChange);
  }, []);

  return pref;
}
