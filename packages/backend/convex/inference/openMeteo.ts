// A tiny Open-Meteo client for the weather tool. Open-Meteo is free and needs
// no API key, so this is just two `fetch` calls: geocoding (name -> coords)
// and the forecast itself. Everything here runs in the default Convex runtime.

export type WeatherUnits = {
  /** "C" or "F" — what `temperature_unit` we asked the API for. */
  temp: "C" | "F";
  /** Matching wind speed unit. */
  wind: "km/h" | "mph";
};

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  /** Best human label, e.g. "Perth, Australia". */
  label: string;
  /** IANA timezone Open-Meteo associates with the place. */
  timezone?: string;
};

export type WeatherHour = {
  /** Local ISO time, e.g. "2026-06-22T14:00". */
  time: string;
  temp: number;
  code: number;
  /** % chance of precipitation, when the API returns it. */
  precipProb?: number;
};

export type WeatherDay = {
  /** Local date, "YYYY-MM-DD". */
  date: string;
  code: number;
  max: number;
  min: number;
  precipProb?: number;
  sunrise?: string;
  sunset?: string;
};

export type WeatherSnapshot = {
  place: string;
  latitude: number;
  longitude: number;
  timezone: string;
  units: WeatherUnits;
  current: {
    temp: number;
    apparentTemp: number;
    humidity: number;
    windSpeed: number;
    code: number;
    isDay: boolean;
    precipitation?: number;
  };
  hourly: WeatherHour[];
  daily: WeatherDay[];
};

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

const HOURLY_WINDOW = 24;
const FORECAST_DAYS = 7;

/**
 * Plain-text label for a WMO weather code. Kept server-side so the tool can
 * hand the model a readable summary; the client has its own copy paired with
 * icons for the widget. The two should stay in sync.
 */
export function weatherCodeLabel(code: number): string {
  switch (code) {
    case 0:
      return "clear sky";
    case 1:
      return "mainly clear";
    case 2:
      return "partly cloudy";
    case 3:
      return "overcast";
    case 45:
    case 48:
      return "fog";
    case 51:
    case 53:
    case 55:
      return "drizzle";
    case 56:
    case 57:
      return "freezing drizzle";
    case 61:
      return "light rain";
    case 63:
      return "rain";
    case 65:
      return "heavy rain";
    case 66:
    case 67:
      return "freezing rain";
    case 71:
      return "light snow";
    case 73:
      return "snow";
    case 75:
      return "heavy snow";
    case 77:
      return "snow grains";
    case 80:
    case 81:
      return "rain showers";
    case 82:
      return "violent rain showers";
    case 85:
    case 86:
      return "snow showers";
    case 95:
      return "thunderstorm";
    case 96:
    case 99:
      return "thunderstorm with hail";
    default:
      return "unknown conditions";
  }
}

export type UnitsSystem = "auto" | "metric" | "imperial";

/** Locale-aware unit choice: imperial only for the handful of places that use it. */
export function unitsForLocale(locale?: string): WeatherUnits {
  const region = locale?.split("-")[1]?.toUpperCase();
  const imperial = region === "US" || region === "LR" || region === "MM";
  return imperial ? { temp: "F", wind: "mph" } : { temp: "C", wind: "km/h" };
}

/** Resolve stored preference into concrete Open-Meteo units. */
export function resolveWeatherUnits(
  pref: UnitsSystem | undefined,
  locale?: string,
): WeatherUnits {
  if (pref === "imperial") return { temp: "F", wind: "mph" };
  if (pref === "metric") return { temp: "C", wind: "km/h" };
  return unitsForLocale(locale);
}

/** Turn an IANA timezone like "Australia/Perth" into a friendly "Perth". */
export function cityFromTimeZone(timeZone?: string): string | undefined {
  if (!timeZone) return undefined;
  const segment = timeZone.split("/").pop();
  if (!segment) return undefined;
  const city = segment.replace(/_/g, " ").trim();
  return city.length > 0 ? city : undefined;
}

type GeocodeApiResponse = {
  results?: Array<{
    latitude: number;
    longitude: number;
    name?: string;
    country?: string;
    admin1?: string;
    timezone?: string;
  }>;
};

/** Resolve a place name to coordinates. Returns null when nothing matches. */
export async function geocode(name: string): Promise<GeocodeResult | null> {
  const query = name.trim();
  if (!query) return null;

  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Geocoding failed (${response.status})`);
  }
  const data = (await response.json()) as GeocodeApiResponse;
  const top = data.results?.[0];
  if (!top) return null;

  const label = [top.name, top.country].filter(Boolean).join(", ") || query;
  return {
    latitude: top.latitude,
    longitude: top.longitude,
    label,
    timezone: top.timezone,
  };
}

type ForecastApiResponse = {
  timezone?: string;
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    apparent_temperature?: number;
    is_day?: number;
    precipitation?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    weather_code?: number[];
    precipitation_probability?: number[];
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    sunrise?: string[];
    sunset?: string[];
  };
};

/** Slice the hourly arrays down to the next ~24h starting from the current hour. */
function buildHourly(
  hourly: NonNullable<ForecastApiResponse["hourly"]>,
  currentTime: string | undefined,
): WeatherHour[] {
  const times = hourly.time ?? [];
  const temps = hourly.temperature_2m ?? [];
  const codes = hourly.weather_code ?? [];
  const probs = hourly.precipitation_probability ?? [];

  // Find the first hour at or after "now"; Open-Meteo returns from local
  // midnight, so the current hour sits partway through the array.
  let start = 0;
  if (currentTime) {
    const currentHour = currentTime.slice(0, 13); // "YYYY-MM-DDTHH"
    const idx = times.findIndex((t) => t.slice(0, 13) >= currentHour);
    if (idx >= 0) start = idx;
  }

  const hours: WeatherHour[] = [];
  for (let i = start; i < times.length && hours.length < HOURLY_WINDOW; i += 1) {
    const temp = temps[i];
    const code = codes[i];
    if (temp === undefined || code === undefined) continue;
    hours.push({
      time: times[i],
      temp,
      code,
      ...(probs[i] !== undefined ? { precipProb: probs[i] } : {}),
    });
  }
  return hours;
}

function buildDaily(
  daily: NonNullable<ForecastApiResponse["daily"]>,
): WeatherDay[] {
  const dates = daily.time ?? [];
  const codes = daily.weather_code ?? [];
  const maxes = daily.temperature_2m_max ?? [];
  const mins = daily.temperature_2m_min ?? [];
  const probs = daily.precipitation_probability_max ?? [];
  const sunrises = daily.sunrise ?? [];
  const sunsets = daily.sunset ?? [];

  const days: WeatherDay[] = [];
  for (let i = 0; i < dates.length && days.length < FORECAST_DAYS; i += 1) {
    const code = codes[i];
    const max = maxes[i];
    const min = mins[i];
    if (code === undefined || max === undefined || min === undefined) continue;
    days.push({
      date: dates[i],
      code,
      max,
      min,
      ...(probs[i] !== undefined ? { precipProb: probs[i] } : {}),
      ...(sunrises[i] ? { sunrise: sunrises[i] } : {}),
      ...(sunsets[i] ? { sunset: sunsets[i] } : {}),
    });
  }
  return days;
}

/** Fetch current conditions plus an hourly + daily forecast for a coordinate. */
export async function forecast({
  latitude,
  longitude,
  place,
  units,
}: {
  latitude: number;
  longitude: number;
  place: string;
  units: WeatherUnits;
}): Promise<WeatherSnapshot> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
    hourly: "temperature_2m,weather_code,precipitation_probability",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    timezone: "auto",
    forecast_days: String(FORECAST_DAYS),
  });
  if (units.temp === "F") params.set("temperature_unit", "fahrenheit");
  if (units.wind === "mph") params.set("wind_speed_unit", "mph");

  const response = await fetch(`${FORECAST_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Forecast failed (${response.status})`);
  }
  const data = (await response.json()) as ForecastApiResponse;
  const current = data.current;
  if (!current || current.temperature_2m === undefined) {
    throw new Error("Forecast response was missing current conditions");
  }

  return {
    place,
    latitude,
    longitude,
    timezone: data.timezone ?? "UTC",
    units,
    current: {
      temp: current.temperature_2m,
      apparentTemp: current.apparent_temperature ?? current.temperature_2m,
      humidity: current.relative_humidity_2m ?? 0,
      windSpeed: current.wind_speed_10m ?? 0,
      code: current.weather_code ?? 0,
      isDay: current.is_day !== 0,
      ...(current.precipitation !== undefined
        ? { precipitation: current.precipitation }
        : {}),
    },
    hourly: data.hourly ? buildHourly(data.hourly, current.time) : [],
    daily: data.daily ? buildDaily(data.daily) : [],
  };
}
