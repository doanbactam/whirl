// Shared waitlist logic — used by both the Vercel edge function (api/waitlist.ts)
// and the Vite dev middleware (vite.config.ts).

// Defense-in-depth strategy (the Vercel Firewall dashboard rate-limit rule is the
// real first line; this is a fallback for direct hits and local dev):
//   1. Strict RFC-ish email shape + length cap
//   2. Disposable / throwaway domain blocklist
//   3. Honeypot field (form must POST `companyWebsite: ""`)
//   4. Per-IP in-memory rate limit (3 attempts / 60s)
//   5. Resend "already exists" treated as success (idempotent UX)

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const MAX_EMAIL_LEN = 254;
const MAX_LOCAL_LEN = 64;

// Unambiguous English profanity that effectively never shows up inside real
// names. Substring match — anything containing one of these is rejected.
const HARD_PROFANITY = [
  "fuck",
  "shit",
  "cunt",
  "dick",
  "cock",
  "bitch",
  "pussy",
  "wank",
  "jerk",
  "boob",
  "tits",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "slut",
  "whore",
];

// Ambiguous short tokens that DO appear inside real names ("speed" contains
// "pee", "asher" contains "ash", etc.) — these only count if they show up as
// a whole token after splitting the local part on [._\-+].
const AMBIGUOUS_TOKENS = new Set([
  "pee",
  "poo",
  "poop",
  "fart",
  "butt",
  "ass",
  "anus",
  "penis",
  "vagina",
  "balls",
  "nut",
  "nuts",
  "sex",
  "test",
  "fake",
  "nope",
  "asdf",
  "qwerty",
  "lol",
  "lmao",
  "rofl",
]);

// Catches "peepeepoopoo", "abcabcabc", "hahahaha" — any 3+ char unit
// immediately repeated. Real names with reduplication (lulu, nana, tata)
// use 2-char units and slip through.
const REPETITION_RE = /(.{3,})\1+/;

function looksLikeJokeLocal(local: string): boolean {
  const lower = local.toLowerCase();
  for (const word of HARD_PROFANITY) {
    if (lower.includes(word)) return true;
  }
  const tokens = lower.split(/[._\-+]+/).filter(Boolean);
  for (const token of tokens) {
    if (AMBIGUOUS_TOKENS.has(token)) return true;
  }
  if (REPETITION_RE.test(lower)) return true;
  return false;
}

// Curated list of high-volume disposable email providers. Not exhaustive — the
// real anti-abuse work happens at the firewall rate-limit layer. Add domains
// here as they show up in your audience.
const DISPOSABLE_DOMAINS = new Set([
  "0-mail.com",
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "anonymbox.com",
  "binkmail.com",
  "bobmail.info",
  "chacuo.net",
  "dispostable.com",
  "emailondeck.com",
  "fakeinbox.com",
  "fake-mail.net",
  "fakemail.net",
  "getairmail.com",
  "getnada.com",
  "grr.la",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "harakirimail.com",
  "incognitomail.com",
  "jetable.org",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailnesia.com",
  "mintemail.com",
  "mohmal.com",
  "mvrht.com",
  "mvrht.net",
  "nada.email",
  "pokemail.net",
  "sharklasers.com",
  "spam4.me",
  "spamgourmet.com",
  "temp-mail.org",
  "temp-mail.io",
  "tempinbox.com",
  "tempmail.com",
  "tempmailo.com",
  "tempr.email",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.net",
  "yopmail.com",
  "yopmail.net",
  "yopmail.fr",
]);

export type WaitlistResult =
  | { ok: true; status: 200; alreadySubscribed?: boolean }
  | { ok: false; status: number; error: string };

export type WaitlistInput = {
  email?: unknown;
  // Honeypot — must be present and empty. Bots that auto-fill every field
  // will tend to populate it; humans never see it.
  companyWebsite?: unknown;
};

export type WaitlistEnv = {
  RESEND_API_KEY?: string;
  RESEND_AUDIENCE_ID?: string;
};

type RateBucket = { count: number; resetAt: number };
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 3;
const rateState = new Map<string, RateBucket>();

function checkRateLimit(ip: string): WaitlistResult | null {
  if (!ip) return null;
  const now = Date.now();
  const bucket = rateState.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateState.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT) {
    return {
      ok: false,
      status: 429,
      error: "Too many attempts. Try again in a minute.",
    };
  }
  return null;
}

export function clientIpFrom(headers: Headers | Record<string, string | string[] | undefined>): string {
  const get = (k: string): string | undefined => {
    if (headers instanceof Headers) return headers.get(k) ?? undefined;
    const raw = headers[k] ?? headers[k.toLowerCase()];
    if (Array.isArray(raw)) return raw[0];
    return raw;
  };
  const fwd = get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return get("x-real-ip") ?? get("cf-connecting-ip") ?? "";
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.length > MAX_EMAIL_LEN) return null;
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at >= trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  if (local.length > MAX_LOCAL_LEN) return null;
  if (local.includes("..")) return null;
  if (!EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

export async function processWaitlistSubmission(
  input: WaitlistInput,
  env: WaitlistEnv,
  ip: string,
): Promise<WaitlistResult> {
  if (typeof input.companyWebsite === "string" && input.companyWebsite.length > 0) {
    // Honeypot tripped — pretend success so bots don't learn.
    return { ok: true, status: 200 };
  }

  const limited = checkRateLimit(ip);
  if (limited) return limited;

  const email = normalizeEmail(input.email);
  if (!email) {
    return {
      ok: false,
      status: 400,
      error: "Please enter a valid email.",
    };
  }

  const atIdx = email.lastIndexOf("@");
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      ok: false,
      status: 400,
      error: "Please use a non-disposable email address.",
    };
  }

  if (looksLikeJokeLocal(local)) {
    return {
      ok: false,
      status: 400,
      error: "Please enter a real email address.",
    };
  }

  const apiKey = env.RESEND_API_KEY;
  const audienceId = env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    return {
      ok: false,
      status: 503,
      error: "Waitlist is not configured. Set RESEND_API_KEY and RESEND_AUDIENCE_ID.",
    };
  }

  try {
    const upstream = await fetch(
      `https://api.resend.com/audiences/${encodeURIComponent(audienceId)}/contacts`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ email, unsubscribed: false }),
      },
    );

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      if (/already exists|already_exists/i.test(detail)) {
        return { ok: true, status: 200, alreadySubscribed: true };
      }
      return {
        ok: false,
        status: 502,
        error: "Couldn't join the waitlist. Try again in a moment.",
      };
    }

    return { ok: true, status: 200 };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : "Unexpected error",
    };
  }
}
