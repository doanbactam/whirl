import { jsonSchema, tool } from "ai";

import {
  cityFromTimeZone,
  forecast,
  geocode,
  unitsForLocale,
  weatherCodeLabel,
  type WeatherSnapshot,
  type WeatherUnits,
} from "./openMeteo";

/** Where "here" resolves to, assembled from the user's reported context. */
export type DefaultLocation = {
  latitude?: number;
  longitude?: number;
  place?: string;
  timeZone?: string;
};

/** The payload persisted onto the assistant message's weather phase. */
export type WeatherPhasePayload = WeatherSnapshot & {
  /** True when we fell back to the timezone-derived city (no precise fix). */
  approximate: boolean;
};

function roundTemp(value: number): number {
  return Math.round(value);
}

function formatHourLocal(localIso: string): string {
  const hour = Number(localIso.slice(11, 13));
  if (Number.isNaN(hour)) return localIso;
  const period = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${period}`;
}

function formatWeekdayLocal(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day) return localDate;
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    timeZone: "UTC",
  }).format(date);
}

/** Everything the weather widget shows, structured for the model. */
function formatWeatherForModel(
  snapshot: WeatherSnapshot,
  approximate: boolean,
  visible: boolean,
) {
  const { current, daily, hourly, units, place, timezone } = snapshot;
  const today = daily[0];

  return {
    place: approximate
      ? `${place} (approximate — derived from timezone, not GPS)`
      : place,
    timezone,
    units,
    current: {
      condition: weatherCodeLabel(current.code),
      temp: roundTemp(current.temp),
      apparentTemp: roundTemp(current.apparentTemp),
      humidityPercent: current.humidity,
      windSpeed: Math.round(current.windSpeed),
      windUnit: units.wind,
      tempUnit: units.temp,
      isDay: current.isDay,
      ...(current.precipitation !== undefined
        ? { precipitationMm: current.precipitation }
        : {}),
      todayHigh: today ? roundTemp(today.max) : undefined,
      todayLow: today ? roundTemp(today.min) : undefined,
    },
    hourly: hourly.map((hour, i) => ({
      time: hour.time,
      label: i === 0 ? "Now" : formatHourLocal(hour.time),
      condition: weatherCodeLabel(hour.code),
      temp: roundTemp(hour.temp),
      ...(hour.precipProb !== undefined
        ? { precipChancePercent: hour.precipProb }
        : {}),
    })),
    daily: daily.map((day, i) => ({
      date: day.date,
      label: i === 0 ? "Today" : formatWeekdayLocal(day.date),
      condition: weatherCodeLabel(day.code),
      high: roundTemp(day.max),
      low: roundTemp(day.min),
      ...(day.precipProb !== undefined
        ? { precipChancePercent: day.precipProb }
        : {}),
    })),
    widgetNote: visible
      ? "The user sees a live widget with this same data. Use the full hourly and daily forecast to answer precisely; don't dump every number in prose unless they asked for specifics."
      : "Invisible mode: no widget is shown. This data is for your own reasoning only — the user can't see any of it, so weave whatever's relevant into your reply yourself.",
  };
}

/**
 * A live weather tool backed by Open-Meteo (no API key needed). The model calls
 * it for "what's the weather" style questions: omit `location` for "here"
 * (resolved from the user's precise coordinates when shared, otherwise their
 * timezone city) or pass a place name to look anywhere up. By default the result
 * is shown to the user as a rich widget; the tool returns the same full snapshot
 * so the model can reason over hourly and multi-day forecasts. Pass
 * `display: false` for invisible mode — the data comes back to the model but no
 * widget is shown to the user.
 */
export function createWeatherTool({
  defaultLocation,
  units: unitsOverride,
  locale,
  onResult,
}: {
  defaultLocation: DefaultLocation;
  units?: WeatherUnits;
  locale?: string;
  onResult: (result: WeatherPhasePayload, visible: boolean) => Promise<void>;
}) {
  const units = unitsOverride ?? unitsForLocale(locale);

  return tool({
    description:
      "Get current, hourly, and 7-day weather. Omit location for the user; display defaults to true.",
    inputSchema: jsonSchema<{ location?: string; display?: boolean }>({
      type: "object",
      properties: {
        location: {
          type: "string",
          maxLength: 120,
          description: "Place name. Omit for the user's location.",
        },
        display: {
          type: "boolean",
          description: "Show the weather widget. Defaults to true.",
        },
      },
      additionalProperties: false,
    }),
    execute: async ({ location, display }) => {
      const visible = display !== false;
      const requested = location?.trim();

      let latitude: number;
      let longitude: number;
      let place: string;
      let approximate = false;

      if (requested) {
        // A named place: geocode it.
        const match = await geocode(requested);
        if (!match) {
          return {
            error: `I couldn't find a place called "${requested}".`,
          };
        }
        latitude = match.latitude;
        longitude = match.longitude;
        place = match.label;
      } else if (
        defaultLocation.latitude !== undefined &&
        defaultLocation.longitude !== undefined
      ) {
        // "Here", with a precise fix the user has shared.
        latitude = defaultLocation.latitude;
        longitude = defaultLocation.longitude;
        place = defaultLocation.place ?? "your location";
      } else {
        // "Here", but only timezone-coarse — geocode the timezone's city.
        const city = cityFromTimeZone(defaultLocation.timeZone);
        if (!city) {
          return {
            error:
              "I don't have a location for you yet. Ask about a specific place, or share your location.",
          };
        }
        const match = await geocode(city);
        if (!match) {
          return {
            error:
              "I couldn't pin down your location. Try naming a city instead.",
          };
        }
        latitude = match.latitude;
        longitude = match.longitude;
        place = match.label;
        approximate = true;
      }

      const snapshot = await forecast({ latitude, longitude, place, units });

      // For a precise "here" fix we had no place name; borrow the city from the
      // timezone the forecast resolved to so the widget reads nicely.
      if (!requested && !approximate && place === "your location") {
        const city = cityFromTimeZone(snapshot.timezone);
        if (city) snapshot.place = city;
      }

      await onResult({ ...snapshot, approximate }, visible);

      return formatWeatherForModel(snapshot, approximate, visible);
    },
  });
}
