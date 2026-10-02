import { StyleSheet, Text, View } from "react-native";

import { spacing, typography, useTheme } from "@/lib/theme";

/** A hairline rule with a word set into it — "or", between auth methods. */
export function Divider({ label }: { label: string }) {
  const { colors } = useTheme();

  return (
    <View style={styles.row}>
      <View style={[styles.rule, { backgroundColor: colors.glassRim }]} />
      <Text style={[typography.caption, { color: colors.foregroundMuted }]}>
        {label}
      </Text>
      <View style={[styles.rule, { backgroundColor: colors.glassRim }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
});
