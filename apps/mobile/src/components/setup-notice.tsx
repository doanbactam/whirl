import { StyleSheet, Text, View } from "react-native";

import { palettes, radius, spacing, typography } from "@/lib/theme";

/**
 * Shown when the app can't start because something is missing from the
 * environment. This renders outside the providers — and possibly before the
 * theme hook is usable — so it hardcodes the light palette and says exactly
 * which variable to set rather than crashing with a Clerk stack trace.
 */
export function SetupNotice({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  const colors = palettes.light;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Text style={[typography.label, { color: colors.danger }]}>{title}</Text>
        <Text style={[typography.caption, { color: colors.foregroundSoft }]}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.panel,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
