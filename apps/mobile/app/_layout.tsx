import { useEffect, useMemo } from "react";
import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as WebBrowser from "expo-web-browser";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StyleSheet } from "react-native";

import { SetupNotice } from "@/components/setup-notice";
import { convexUrl, createConvexClient } from "@/lib/convex";
import { useTheme } from "@/lib/theme";

/* Keep the splash up until Clerk has read the token cache, so a returning
   user never sees the sign-in screen flash past on the way to their session. */
void SplashScreen.preventAutoHideAsync();

/* No-op on native; on web it closes the tab the OAuth redirect landed in. */
WebBrowser.maybeCompleteAuthSession();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout() {
  /* Built once and kept: a new client per render would drop every open
     subscription and re-open it on the next frame. */
  const convex = useMemo(
    () => (convexUrl ? createConvexClient(convexUrl) : null),
    [],
  );

  if (!publishableKey) {
    void SplashScreen.hideAsync();
    return (
      <SetupNotice
        title="Missing Clerk publishable key"
        detail="Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in apps/mobile/.env.local, then restart the bundler."
      />
    );
  }

  if (!convex) {
    void SplashScreen.hideAsync();
    return (
      <SetupNotice
        title="Missing Convex URL"
        detail="Set EXPO_PUBLIC_CONVEX_URL in apps/mobile/.env.local, then restart the bundler."
      />
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
          {/* Convex takes its identity from Clerk's `convex` JWT template, so
              it has to sit inside the provider that can mint one. */}
          <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
            <RootNavigator />
          </ConvexProviderWithClerk>
        </ClerkProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { isLoaded } = useAuth();
  const { colors } = useTheme();

  useEffect(() => {
    if (!isLoaded) return;
    // Rejects only if the splash is already gone, which is fine either way.
    SplashScreen.hideAsync().catch(() => {});
  }, [isLoaded]);

  // Holding here means the route guards never run against an unknown session.
  if (!isLoaded) return null;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Without this the transition flashes white in dark mode.
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
