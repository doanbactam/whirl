import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { spacing } from "@/lib/theme";

/**
 * The submit / or / Google stack.
 *
 * Deliberately a plain view, not a `GlassContainer`. The container is the
 * sanctioned way to group glass, but it nests a second effect view around the
 * panes' own, and the two racing on mount was a source of panes coming up
 * clear. It only earns that risk when the panes are close enough to merge —
 * with a divider and a full gap between these two, it was buying nothing.
 */
export function AuthActions({ children }: { children: ReactNode }) {
  return <View style={styles.stack}>{children}</View>;
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.lg,
  },
});
