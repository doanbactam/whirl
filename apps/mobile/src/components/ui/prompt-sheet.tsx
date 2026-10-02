import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";

import { duration } from "@/lib/motion";
import { radius, size, spacing, typography, useTheme } from "@/lib/theme";

type PromptSheetProps = {
  visible: boolean;
  title: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onDismiss: () => void;
};

/**
 * Ask for one line of text.
 *
 * Deliberately not `Alert.prompt`, which only exists on iOS and would leave
 * every other platform without a way to rename anything. Solid surfaces rather
 * than glass: a modal is its own native window, so there's nothing of the app
 * behind it for the material to refract.
 */
export function PromptSheet({
  visible,
  title,
  placeholder,
  initialValue = "",
  submitLabel = "Save",
  onSubmit,
  onDismiss,
}: PromptSheetProps) {
  const { colors } = useTheme();
  const input = useRef<TextInput>(null);
  const [value, setValue] = useState(initialValue);

  /* Re-seeded on each open so the field always shows the *current* name, not
     whatever was in it the last time the sheet was used. */
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(trimmed);
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
      onShow={() => input.current?.focus()}
    >
      <Animated.View
        entering={FadeIn.duration(duration.fast)}
        exiting={FadeOut.duration(duration.fast)}
        style={styles.fill}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={onDismiss}
          style={[styles.scrim, { backgroundColor: colors.scrim }]}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.dock}
          pointerEvents="box-none"
        >
          <Animated.View entering={FadeInDown.duration(duration.base)}>
            <View
              style={[
                styles.sheet,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[typography.label, { color: colors.foregroundSoft }]}>
                {title}
              </Text>

              <TextInput
                ref={input}
                value={value}
                onChangeText={setValue}
                placeholder={placeholder}
                placeholderTextColor={colors.foregroundMuted}
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={submit}
                style={[
                  styles.input,
                  typography.body,
                  {
                    color: colors.foreground,
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              />

              <View style={styles.actions}>
                <SheetButton label="Cancel" onPress={onDismiss} />
                <SheetButton
                  label={submitLabel}
                  onPress={submit}
                  disabled={!canSubmit}
                  primary
                />
              </View>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

/** A flat capsule. Solid on purpose — see the note on the sheet itself. */
function SheetButton({
  label,
  onPress,
  disabled = false,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary
            ? pressed
              ? colors.primaryPressed
              : colors.primary
            : pressed
              ? colors.secondaryPressed
              : colors.secondary,
        },
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          typography.label,
          { color: primary ? colors.primaryForeground : colors.foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrim: {
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
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.panel,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    height: size.controlSmall,
    paddingHorizontal: spacing.md,
    borderRadius: radius.controlSmall,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  button: {
    height: size.controlSmall,
    minWidth: 96,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radius.controlSmall,
  },
  disabled: {
    opacity: 0.45,
  },
});
