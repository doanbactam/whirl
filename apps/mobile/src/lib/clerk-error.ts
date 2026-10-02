/**
 * Clerk's raw messages swing between terse ("Incorrect password") and
 * developer-facing ("Enter code failed. Code must be 6 digits."). Everything
 * the user can actually see goes through here so the wording is ours.
 */

type ClerkLikeError = {
  code?: unknown;
  message?: unknown;
  longMessage?: unknown;
};

/** Codes we have better copy for than Clerk ships. */
const FRIENDLY_BY_CODE: Record<string, string> = {
  // Identifier
  form_identifier_not_found: "We couldn't find an account with that email.",
  form_identifier_exists: "That email is already registered. Try signing in.",
  form_param_format_invalid: "That doesn't look like a valid email address.",
  form_param_nil: "Please fill this in.",

  // Password
  form_password_incorrect: "That password isn't right.",
  form_password_validation_failed: "That password isn't right.",
  form_password_length_too_short: "Passwords need to be at least 8 characters.",
  form_password_pwned:
    "That password has turned up in a data breach. Please pick a different one.",
  form_password_not_strong_enough:
    "That password is a little too guessable. Try a longer one.",

  // Verification codes
  form_code_incorrect: "That code isn't right. Check the email and try again.",
  verification_expired: "That code expired. Send a fresh one.",
  verification_failed: "Too many wrong attempts. Send a fresh code.",
  verification_already_verified: "That's already verified — you're good to go.",

  // Session / rate limiting
  session_exists: "You're already signed in.",
  too_many_requests: "Too many attempts. Give it a minute and try again.",
  captcha_invalid:
    "We couldn't verify this device. Try again, or use a different network.",
};

const GENERIC =
  "Something went wrong on our end. Please try again in a moment.";

const NETWORK =
  "We couldn't reach the network. Check your connection and try again.";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Best available message for one Clerk error — ours if we have it, otherwise
 * Clerk's own wording, and only then the catch-all.
 */
export function describeClerkError(error: unknown): string {
  if (!error) return GENERIC;

  const candidate = error as ClerkLikeError;
  const code = asString(candidate.code);
  if (code && FRIENDLY_BY_CODE[code]) return FRIENDLY_BY_CODE[code];

  const message = asString(candidate.longMessage) ?? asString(candidate.message);
  if (!message) return GENERIC;

  /* Network failures reach us as plain Errors with browser wording; they're
     the one non-Clerk case common enough to name properly. */
  if (/network request failed|fetch failed|timeout/i.test(message)) {
    return NETWORK;
  }

  return message;
}

/**
 * Same treatment for the per-field errors the `useSignIn`/`useSignUp` signals
 * expose. Returns `undefined` so it can be spread straight onto a TextField.
 */
export function describeFieldError(
  field: ClerkLikeError | null | undefined,
): string | undefined {
  if (!field) return undefined;
  return describeClerkError(field);
}

/**
 * The user closing the OAuth browser tab isn't an error worth shouting about.
 * Callers use this to stay silent instead of flashing a red banner.
 */
export function isUserCancelled(error: unknown): boolean {
  const message = asString((error as ClerkLikeError)?.message) ?? "";
  return /cancel|dismiss/i.test(message);
}
