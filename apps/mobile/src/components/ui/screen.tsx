import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { spacing, useTheme } from "@/lib/theme";

type ScreenProps = {
  children: ReactNode;
  /**
   * Lets the content scroll out from under the keyboard. Forms want this; a
   * screen that fits on its own doesn't.
   */
  scrollable?: boolean;
  /** Vertically centers the content in the leftover space. */
  centered?: boolean;
  /**
   * Lifts the whole frame clear of the keyboard. Turn it off where something
   * inside already tracks the keyboard itself — two things moving for the one
   * keyboard is twice the distance and half the smoothness.
   */
  keyboardAvoiding?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * The frame every screen sits in: themed background, matching status bar,
 * safe-area insets, and keyboard avoidance.
 */
export function Screen({
  children,
  scrollable = false,
  centered = false,
  keyboardAvoiding = true,
  contentStyle,
}: ScreenProps) {
  const { colors, isDark } = useTheme();

  const content = [styles.content, centered && styles.centered, contentStyle];

  const body = scrollable ? (
    <ScrollView
      contentContainerStyle={content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={content}>{children}</View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Light background wants dark glyphs, and the reverse. */}
      <StatusBar style={isDark ? "light" : "dark"} />
      <SafeAreaView style={styles.flex}>
        {keyboardAvoiding ? (
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            {body}
          </KeyboardAvoidingView>
        ) : (
          body
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },
  centered: {
    justifyContent: "center",
  },
});
