import { Pressable, StyleSheet, Text, View } from "react-native";
import { IconLogout } from "@tabler/icons-react-native";

import { Button } from "@/components/ui/button";
import { radius, spacing, typography, useTheme } from "@/lib/theme";

type AccountSheetProps = {
  email?: string;
  onSignOut: () => void;
  onDismiss: () => void;
  signingOut: boolean;
  error: string | null;
};

/**
 * Who you're signed in as, and the way out.
 *
 * Rendered inline over the screen rather than in a `Modal`: a modal lives in
 * its own native window, and glass in there has nothing of the app behind it
 * to refract.
 *
 * The card itself is solid, not glass — it holds a glass button, and stacking
 * the two would put glass on glass. The sheet is the ground here; the button
 * on it is the material.
 */
export function AccountSheet({
  email,
  onSignOut,
  onDismiss,
  signingOut,
  error,
}: AccountSheetProps) {
  const { colors } = useTheme();

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onDismiss}
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
      />

      <View style={styles.dock}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderColor: colors.glassRim },
          ]}
        >
          {email ? (
            <Text
              style={[typography.caption, { color: colors.foregroundMuted }]}
            >
              Signed in as {email}
            </Text>
          ) : null}

          {/* Plain text, not the usual banner: the banner is itself a pane,
              and glass on glass is the one thing the material can't do. */}
          {error ? (
            <Text style={[typography.caption, { color: colors.danger }]}>
              {error}
            </Text>
          ) : null}

          <Button
            label="Sign out"
            variant="secondary"
            icon={IconLogout}
            loading={signingOut}
            onPress={onSignOut}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    // RN's own `absoluteFill` is a registered style, so it can't be spread.
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  dock: {
    marginTop: "auto",
    padding: spacing.lg,
  },
  sheet: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.panel,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
