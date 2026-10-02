import { useAuth } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";

/** Signed-in users have no business on the sign in / sign up screens. */
export default function AuthLayout() {
  const { isSignedIn } = useAuth();

  if (isSignedIn) return <Redirect href="/" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        /* No transition, and for a hard reason: a fade animates the whole
           screen's alpha, and a glass pane created under a transparent
           ancestor never renders its effect. Sign in and sign up are the same
           furniture with different words anyway — the header entrance on each
           side carries the change. */
        animation: "none",
      }}
    />
  );
}
