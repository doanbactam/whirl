"use client";

import { useState } from "react";
import { useSignUp } from "@clerk/nextjs";
import { IconMailFilled } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { ANALYTICS_EVENTS, captureEvent } from "@/lib/posthog";
import {
  BackButton,
  CaptchaSlot,
  describeError,
  Divider,
  ErrorNote,
  GoogleButton,
  StepTitle,
  stepMotion,
  SubmitButton,
  SubtleAction,
  SwitchHint,
} from "./bits";
import { CodeField, IconField, PasswordField } from "./fields";

type Step = "start" | "verify-email";

/* Funnel step 2 (W-155). The email path finishes right here, so we can say so
   the moment it does. Google leaves for an SSO round trip and comes back to a
   fresh page with no panel left to report it — that half is covered by the
   Clerk user.created webhook (packages/backend/convex/clerk.ts), which PostHog
   folds together with this by distinct id. `signup_started` is captured for
   both, so the drop-off between choosing a method and having an account is
   readable on its own. */

export function SignUpPanel({
  onSwitch,
  onDone,
}: {
  onSwitch: () => void;
  onDone: () => void;
}) {
  const { signUp } = useSignUp();
  const [step, setStep] = useState<Step>("start");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const [busy, setBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finalize = async () => {
    const { error } = await signUp.finalize();
    if (error) {
      setError(describeError(error));
      return;
    }
    captureEvent(ANALYTICS_EVENTS.signupCompleted, { method: "email" });
    onDone();
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signUp || busy) return;
    setError(null);
    setBusy(true);
    captureEvent(ANALYTICS_EVENTS.signupStarted, { method: "email" });

    const created = await signUp.password({ emailAddress: email, password });
    if (created.error) {
      setError(describeError(created.error));
      setBusy(false);
      return;
    }

    if (signUp.status === "complete") {
      await finalize();
    } else {
      const { error } = await signUp.verifications.sendEmailCode();
      if (error) {
        setError(describeError(error));
      } else {
        setStep("verify-email");
      }
    }
    setBusy(false);
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signUp || busy) return;
    setError(null);
    setBusy(true);

    const { error } = await signUp.verifications.verifyEmailCode({ code });
    if (error) {
      setError(describeError(error));
    } else if (signUp.status === "complete") {
      await finalize();
    } else {
      setError("Couldn't verify your email. Try again.");
    }
    setBusy(false);
  };

  const handleResend = async () => {
    if (!signUp || busy) return;
    setError(null);
    const { error } = await signUp.verifications.sendEmailCode();
    if (error) setError(describeError(error));
  };

  const handleGoogle = async () => {
    if (!signUp || busy) return;
    setError(null);
    setBusy(true);
    setRedirecting(true);
    captureEvent(ANALYTICS_EVENTS.signupStarted, { method: "google" });
    const { error } = await signUp.sso({
      strategy: "oauth_google",
      redirectUrl: "/",
      redirectCallbackUrl: "/sso-callback",
    });
    if (error) {
      setError(describeError(error));
      setBusy(false);
      setRedirecting(false);
    }
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {step === "start" && (
        <motion.div key="start" {...stepMotion}>
          <StepTitle
            title="Create your account"
            subtitle="Spin up a Whirl account in seconds."
          />
          <GoogleButton
            onClick={handleGoogle}
            disabled={busy}
            redirecting={redirecting}
            signUp
          />
          <Divider />
          <form onSubmit={handleSignUp} className="flex flex-col gap-2.5">
            <IconField
              icon={IconMailFilled}
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={setEmail}
              required
              autoFocus
            />
            <PasswordField
              autoComplete="new-password"
              placeholder="Password"
              value={password}
              onChange={setPassword}
              required
            />
            <ErrorNote message={error} />
            <CaptchaSlot />
            <SubmitButton busy={busy && !redirecting} held={redirecting}>
              Create account
            </SubmitButton>
          </form>
          <SwitchHint
            prompt="Already have an account?"
            actionLabel="Sign in"
            onClick={onSwitch}
          />
        </motion.div>
      )}

      {step === "verify-email" && (
        <motion.div key="verify-email" {...stepMotion}>
          <BackButton
            onClick={() => {
              setError(null);
              setStep("start");
            }}
          />
          <StepTitle
            title="Verify your email"
            subtitle={`Enter the 6-digit code we sent to ${email}.`}
          />
          <form onSubmit={handleVerify} className="flex flex-col gap-2.5">
            <CodeField
              value={code}
              onChange={setCode}
              placeholder="123456"
              autoFocus
              required
            />
            <SubtleAction onClick={handleResend} className="-mt-0.5 self-start">
              Resend code
            </SubtleAction>
            <ErrorNote message={error} />
            <SubmitButton busy={busy}>Verify email</SubmitButton>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
