import { useCallback, useEffect, useState } from "react";

// Approximate plan prices in the visitor's own currency. Billing itself stays
// in USD (Autumn/Stripe) — this is purely a display convenience, so every step
// degrades to plain USD: unknown region, missing/stale rates, a currency Intl
// doesn't know, SSR. The first client render always matches the server (USD)
// and the local price swaps in after hydration, so there's no mismatch.

/** ISO region → ISO 4217 currency for the regions we can meaningfully map. */
const REGION_CURRENCY: Record<string, string> = {
  // Americas
  US: "USD", CA: "CAD", MX: "MXN", BR: "BRL", AR: "ARS", CL: "CLP",
  CO: "COP", PE: "PEN", UY: "UYU", BO: "BOB", PY: "PYG", CR: "CRC",
  GT: "GTQ", DO: "DOP", JM: "JMD", TT: "TTD", PA: "USD", EC: "USD",
  SV: "USD", PR: "USD", VE: "VES",
  // Europe (euro area)
  AT: "EUR", BE: "EUR", CY: "EUR", DE: "EUR", EE: "EUR", ES: "EUR",
  FI: "EUR", FR: "EUR", GR: "EUR", HR: "EUR", IE: "EUR", IT: "EUR",
  LT: "EUR", LU: "EUR", LV: "EUR", MT: "EUR", NL: "EUR", PT: "EUR",
  SI: "EUR", SK: "EUR", MC: "EUR", AD: "EUR", SM: "EUR", VA: "EUR",
  ME: "EUR", XK: "EUR",
  // Europe (rest)
  GB: "GBP", CH: "CHF", LI: "CHF", NO: "NOK", SE: "SEK", DK: "DKK",
  IS: "ISK", PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN",
  RS: "RSD", BA: "BAM", MK: "MKD", AL: "ALL", MD: "MDL", UA: "UAH",
  BY: "BYN", RU: "RUB", TR: "TRY", GE: "GEL", AM: "AMD", AZ: "AZN",
  // Middle East & Africa
  AE: "AED", SA: "SAR", QA: "QAR", KW: "KWD", BH: "BHD", OM: "OMR",
  IL: "ILS", JO: "JOD", LB: "LBP", EG: "EGP", MA: "MAD", TN: "TND",
  DZ: "DZD", NG: "NGN", GH: "GHS", KE: "KES", TZ: "TZS", UG: "UGX",
  ET: "ETB", ZA: "ZAR", BW: "BWP", MU: "MUR", ZM: "ZMW", RW: "RWF",
  IQ: "IQD", IR: "IRR",
  // Asia-Pacific
  IN: "INR", PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR", CN: "CNY",
  JP: "JPY", KR: "KRW", TW: "TWD", HK: "HKD", MO: "MOP", SG: "SGD",
  MY: "MYR", TH: "THB", VN: "VND", PH: "PHP", ID: "IDR", KH: "KHR",
  LA: "LAK", MM: "MMK", MN: "MNT", KZ: "KZT", UZ: "UZS", KG: "KGS",
  AU: "AUD", NZ: "NZD", FJ: "FJD", PG: "PGK",
};

const RATES_CACHE_KEY = "fx-rates-usd:v1";
const RATES_TTL_MS = 24 * 60 * 60 * 1000;
const RATES_URL = "https://open.er-api.com/v6/latest/USD";

type RatesCache = { fetchedAt: number; rates: Record<string, number> };

/**
 * The visitor's currency from their browser locales — `maximize()` fills in
 * the likely region for bare language tags ("de" → DE). Null when it's USD or
 * we can't tell (then there's nothing to convert).
 */
function detectLocalCurrency(): string | null {
  try {
    const locales =
      navigator.languages && navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language];
    for (const tag of locales) {
      if (!tag) continue;
      try {
        const region = new Intl.Locale(tag).maximize().region;
        const currency = region ? REGION_CURRENCY[region] : undefined;
        if (currency) return currency === "USD" ? null : currency;
      } catch {
        // unparsable tag — try the next one
      }
    }
  } catch {
    // no navigator/Intl.Locale — stay on USD
  }
  return null;
}

function readCachedRates(): RatesCache | null {
  try {
    const raw = localStorage.getItem(RATES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RatesCache;
    if (
      typeof parsed?.fetchedAt !== "number" ||
      typeof parsed?.rates !== "object" ||
      parsed.rates == null ||
      Date.now() - parsed.fetchedAt > RATES_TTL_MS
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function loadUsdRates(): Promise<Record<string, number> | null> {
  const cached = readCachedRates();
  if (cached) return cached.rates;
  try {
    const res = await fetch(RATES_URL);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
    };
    if (data?.result !== "success" || !data.rates) return null;
    try {
      localStorage.setItem(
        RATES_CACHE_KEY,
        JSON.stringify({ fetchedAt: Date.now(), rates: data.rates }),
      );
    } catch {
      // storage full/blocked — still usable for this session
    }
    return data.rates;
  } catch {
    return null;
  }
}

/** "$12" — the untouched-USD look the plan cards have always had. */
function formatUsdPlain(usd: number): string {
  const rounded = Math.round(usd * 100) / 100;
  return `$${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}`;
}

/**
 * Local-currency formatting via Intl so symbols, grouping, and zero-decimal
 * currencies (JPY, KRW…) come out right. Converted prices are approximate, so
 * amounts ≥ 10 round to whole units; smaller ones keep exactly two decimals
 * ("4,60 €", not "4,6 €") so cheap plans still read like prices.
 */
function formatLocalAmount(currency: string, amount: number): string | null {
  const wholeUnits = amount === 0 || amount >= 10;
  const base: Intl.NumberFormatOptions = {
    style: "currency",
    currency,
    minimumFractionDigits: wholeUnits ? 0 : 2,
    maximumFractionDigits: wholeUnits ? 0 : 2,
  };
  try {
    return new Intl.NumberFormat(undefined, {
      ...base,
      currencyDisplay: "narrowSymbol",
    }).format(amount);
  } catch {
    try {
      return new Intl.NumberFormat(undefined, base).format(amount);
    } catch {
      return null;
    }
  }
}

export type LocalCurrency = {
  /** Formats a USD amount for display — local currency when available, else USD. */
  format: (usd: number) => string;
  /** ISO code of what `format` outputs ("USD" until a conversion is ready). */
  currency: string;
  /** True once prices are being shown converted (i.e. not plain USD). */
  isLocal: boolean;
};

/**
 * Client-side hook behind the localized plan prices. Resolves the visitor's
 * currency and a cached USD exchange rate after mount; until then (and on any
 * failure) `format` renders plain USD.
 */
export function useLocalCurrency(): LocalCurrency {
  const [local, setLocal] = useState<{
    currency: string;
    rate: number;
  } | null>(null);

  useEffect(() => {
    const currency = detectLocalCurrency();
    if (!currency) return;
    let cancelled = false;
    void loadUsdRates().then((rates) => {
      if (cancelled || !rates) return;
      const rate = rates[currency];
      // A conversion only beats USD if the rate is sane and Intl can render
      // the currency — probe once so `format` can never blow up mid-render.
      if (
        typeof rate !== "number" ||
        !Number.isFinite(rate) ||
        rate <= 0 ||
        formatLocalAmount(currency, 1) == null
      ) {
        return;
      }
      setLocal({ currency, rate });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const format = useCallback(
    (usd: number) => {
      if (!Number.isFinite(usd) || usd < 0) return formatUsdPlain(0);
      if (local) {
        const converted = formatLocalAmount(local.currency, usd * local.rate);
        if (converted != null) return converted;
      }
      return formatUsdPlain(usd);
    },
    [local],
  );

  return {
    format,
    currency: local?.currency ?? "USD",
    isLocal: local != null,
  };
}
