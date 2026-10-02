import { useRef, useState } from "react";
import type { TextInput } from "react-native";
import { useSignUp } from "@clerk/expo";
import { useRouter } from "expo-router";

import { AuthActions } from "@/components/auth/auth-actions";
import { AuthScreen } from "@/components/auth/auth-screen";
import { GoogleButton } from "@/components/auth/google-button";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { TextField } from "@/components/ui/text-field";
import { TextLink } from "@/components/ui/text-link";
import {
  feedbackFrom,
  formFeedback,
  messageFor,
  type Feedback,
} from "@/lib/form-feedback";

const MIN_PASSWORD_LENGTH = 8;

type Step = "details" | "verify";

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp } = useSignUp();

  const passwordRef = useRef<TextInput>(null);
  const [step, setStep] = useState<Step>("details");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  /** Turns a completed sign-up into an active session. */
  const finalize = async () => {
    const { error } = await signUp.finalize();
    if (error) setFeedback(feedbackFrom(error));
  };

  const handleCreate = async () => {
    if (submitting) return;
    setFeedback(null);

    const emailAddress = email.trim();
    if (!emailAddress || !password) {
      setFeedback(formFeedback("Enter an email and a password to get started."));
      return;
    }
    /* Clerk enforces this server-side too, but catching it here saves the
       user a round trip to be told something they can already see. */
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFeedback({
        message: `Passwords need to be at least ${MIN_PASSWORD_LENGTH} characters.`,
        field: "password",
      });
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await signUp.create({ emailAddress, password });
      if (error) {
        setFeedback(feedbackFrom(error));
        return;
      }

      // Instances with email verification turned off finish right here.
      if (signUp.status === "complete") {
        await finalize();
        return;
      }

      const { error: sendError } = await signUp.verifications.sendEmailCode();
      if (sendError) {
        setFeedback(feedbackFrom(sendError));
        return;
      }

      setStep("verify");
    } catch (error) {
      setFeedback(feedbackFrom(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (code: string) => {
    if (submitting) return;
    setFeedback(null);
    setSubmitting(true);

    try {
      const { error } = await signUp.verifications.verifyEmailCode({ code });
      if (error) {
        setFeedback(feedbackFrom(error));
        return;
      }

      if (signUp.status !== "complete") {
        setFeedback(
          formFeedback(
            "Your email is verified, but the account needs more details than the app collects yet. Finish signing up on the web.",
          ),
        );
        return;
      }

      await finalize();
    } catch (error) {
      setFeedback(feedbackFrom(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (resending) return;
    setFeedback(null);
    setResending(true);

    try {
      const { error } = await signUp.verifications.sendEmailCode();
      if (error) setFeedback(feedbackFrom(error));
    } catch (error) {
      setFeedback(feedbackFrom(error));
    } finally {
      setResending(false);
    }
  };

  /** Drops the half-finished attempt so a fresh email can be entered. */
  const handleUseDifferentEmail = async () => {
    setFeedback(null);
    setStep("details");
    setPassword("");
    await signUp.reset();
  };

  if (step === "verify") {
    return (
      <AuthScreen
        stepKey="verify"
        title="Check your email"
        subtitle={`We sent a six-digit code to ${email.trim()}.`}
        error={messageFor(feedback, null)}
      >
        <VerifyEmailForm
          onSubmit={handleVerify}
          onResend={handleResend}
          onUseDifferentEmail={handleUseDifferentEmail}
          error={messageFor(feedback, "code")}
          submitting={submitting}
          resending={resending}
        />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      stepKey="details"
      title="Create your account"
      subtitle="A minute now, and Whirl is yours."
      error={messageFor(feedback, null)}
      footer={
        <TextLink
          prompt="Already have an account?"
          label="Sign in"
          onPress={() => router.replace("/sign-in")}
        />
      }
    >
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={messageFor(feedback, "identifier")}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />

      <TextField
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={messageFor(feedback, "password")}
        placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
        secure
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={handleCreate}
      />

      <AuthActions>
        <Button
          label="Create account"
          loading={submitting}
          onPress={handleCreate}
        />

        <Divider label="or" />

        <GoogleButton
          label="Continue with Google"
          onError={(message) =>
            setFeedback(message ? formFeedback(message) : null)
          }
        />
      </AuthActions>
    </AuthScreen>
  );
}
