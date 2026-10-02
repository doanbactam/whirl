import { useAuth } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";

/** Everything in this group requires a session. */
export default function AppLayout() {
  const { isSignedIn } = useAuth();

  if (!isSignedIn) return <Redirect href="/sign-in" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // A fade would animate the screen's alpha over its glass. See (auth).
        animation: "none",
      }}
    />
  );
}
