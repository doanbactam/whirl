import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useSSO } from "@clerk/expo/experimental";
import { IconBrandGoogleFilled } from "@tabler/icons-react-native";
import * as WebBrowser from "expo-web-browser";

import { Button } from "@/components/ui/button";
import { describeClerkError } from "@/lib/clerk-error";

/**
 * Android takes a noticeable beat to spin up its custom tab. Warming it while
 * the user is still reading the form hides that cost entirely.
 */
function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS === "web") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

type GoogleButtonProps = {
  label: string;
  onError: (message: string | null) => void;
};

/**
 * One button covers both sign in and sign up: the experimental `useSSO` hook
 * transfers to a sign-up when Google returns someone we've never seen, and
 * activates the session itself — so there's nothing to finalize here.
 */
export function GoogleButton({ label, onError }: GoogleButtonProps) {
  useWarmUpBrowser();
  const { startSSOFlow } = useSSO();
  const [busy, setBusy] = useState(false);

  const handlePress = async () => {
    if (busy) return;
    setBusy(true);
    onError(null);

    try {
      await startSSOFlow({ strategy: "oauth_google" });
      /* On success the session is already active and the signed-in guard
         swaps the route out from under us. A closed browser tab resolves
         here too, with no session and nothing to say about it. */
    } catch (error) {
      onError(describeClerkError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      label={label}
      variant="secondary"
      icon={IconBrandGoogleFilled}
      loading={busy}
      onPress={handlePress}
    />
  );
}
