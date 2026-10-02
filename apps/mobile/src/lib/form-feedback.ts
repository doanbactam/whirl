import { describeClerkError } from "./clerk-error";

/**
 * Which input a problem belongs under. `null` means it isn't attributable to
 * one input — those surface in the form-level banner instead.
 */
export type FeedbackField = "identifier" | "password" | "code" | null;

export type Feedback = {
  message: string;
  field: FeedbackField;
};

/*
 * The `useSignIn`/`useSignUp` signals expose their own `errors.fields`, but
 * reading both that and the returned error means the same sentence can appear
 * twice — once under the input and once in the banner. Placement is decided
 * here instead, from the error code alone, so there's exactly one home for
 * every message.
 */
const FIELD_BY_CODE: Record<string, Exclude<FeedbackField, null>> = {
  form_identifier_not_found: "identifier",
  form_identifier_exists: "identifier",
  form_param_format_invalid: "identifier",

  form_password_incorrect: "password",
  form_password_validation_failed: "password",
  form_password_length_too_short: "password",
  form_password_pwned: "password",
  form_password_not_strong_enough: "password",

  form_code_incorrect: "code",
  verification_expired: "code",
  verification_failed: "code",
};

export function feedbackFrom(error: unknown): Feedback {
  const code = (error as { code?: unknown })?.code;
  const field = typeof code === "string" ? (FIELD_BY_CODE[code] ?? null) : null;
  return { message: describeClerkError(error), field };
}

/** A message the caller wrote itself, shown in the banner. */
export function formFeedback(message: string): Feedback {
  return { message, field: null };
}

/**
 * Reads the message for one slot. Pass `null` for the form-level banner.
 * Returns `undefined` so it drops straight onto a TextField's `error` prop.
 */
export function messageFor(
  feedback: Feedback | null,
  field: FeedbackField,
): string | undefined {
  if (!feedback || feedback.field !== field) return undefined;
  return feedback.message;
}
