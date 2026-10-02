import { StyleSheet, Text, View } from "react-native";
import { IconAlertCircleFilled } from "@tabler/icons-react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { radius, spacing, typography, useTheme } from "@/lib/theme";

/**
 * A form-level problem — something that isn't attributable to one field, like
 * "couldn't reach Clerk" or "that account is locked". Renders nothing when
 * there's no message, so callers can drop it in unconditionally.
 *
 * It arrives without an entrance. It used to fade in, but a fade is an alpha
 * animation over a glass pane, which stops the effect rendering — and the
 * banner would have been the one surface where that was hardest to spot. The
 * field it belongs to shakes instead, which is the louder signal anyway.
 */
export function FormError({ message }: { message?: string | null }) {
  const { colors } = useTheme();
  if (!message) return null;

  return (
    <View accessibilityRole="alert">
      <GlassSurface
        radius={radius.panel}
        tint={colors.dangerSoft}
        fallback={colors.dangerSoft}
        rim={false}
        style={[styles.banner, { borderColor: colors.danger }]}
      >
        <IconAlertCircleFilled size={18} color={colors.danger} />
        <Text style={[typography.caption, styles.text, { color: colors.danger }]}>
          {message}
        </Text>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: {
    flex: 1,
  },
});
