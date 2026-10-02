import { useRef, useState } from "react";
import type { TextInput } from "react-native";
import { useSignIn } from "@clerk/expo";
import { useRouter } from "expo-router";

import { AuthActions } from "@/components/auth/auth-actions";
import { AuthScreen } from "@/components/auth/auth-screen";
import { GoogleButton } from "@/components/auth/google-button";
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

export default function SignInScreen() {
  const router = useRouter();
  const { signIn } = useSignIn();

  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    setFeedback(null);

    const identifier = email.trim();
    if (!identifier || !password) {
      setFeedback(formFeedback("Enter your email and password to continue."));
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await signIn.password({ identifier, password });
      if (error) {
        setFeedback(feedbackFrom(error));
        return;
      }

      if (signIn.status !== "complete") {
        /* Second factors, password resets and the like are real states we
           simply haven't built screens for — say so plainly rather than
           leaving the user on a form that looks like it failed. */
        setFeedback(
          formFeedback(
            "This account needs an extra verification step that the app doesn't support yet. Sign in on the web for now.",
          ),
        );
        return;
      }

      // Activating the session flips the guard, which swaps the route for us.
      const { error: finalizeError } = await signIn.finalize();
      if (finalizeError) setFeedback(feedbackFrom(finalizeError));
    } catch (error) {
      setFeedback(feedbackFrom(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScreen
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
      error={messageFor(feedback, null)}
      footer={
        <TextLink
          prompt="New here?"
          label="Create an account"
          onPress={() => router.replace("/sign-up")}
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
        placeholder="Your password"
        secure
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
      />

      <AuthActions>
        <Button label="Sign in" loading={submitting} onPress={handleSubmit} />

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
