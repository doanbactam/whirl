import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import {
  IconArrowUp,
  IconPlus,
  IconSparklesFilled,
} from "@tabler/icons-react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { IconButton } from "@/components/ui/icon-button";
import { spacing, typography, useTheme } from "@/lib/theme";

type ComposerProps = {
  onSend: (text: string) => void;
  onAttach: () => void;
  /** Which model the next turn goes to. */
  model: string;
  placeholder?: string;
};

/** Roomy enough to be a panel rather than a capsule, since it holds two rows. */
const PANEL_RADIUS = 26;
const ACTION_SIZE = 36;

/**
 * The docked composer: the message on top, and the controls under it — attach
 * and the model on the left, send on the right.
 */
export function Composer({
  onSend,
  onAttach,
  model,
  placeholder = "Ask anything",
}: ComposerProps) {
  const { colors } = useTheme();
  const [text, setText] = useState("");

  const trimmed = text.trim();

  const submit = () => {
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  };

  return (
    /* The bar is the pane; everything on it takes a plain fill. Stacking a
       second piece of glass on the first is the one thing to avoid. */
    <GlassSurface radius={PANEL_RADIUS} style={styles.panel}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        style={[styles.input, typography.body, { color: colors.foreground }]}
        returnKeyType="send"
        onSubmitEditing={submit}
        multiline
      />

      <View style={styles.row}>
        <IconButton
          icon={IconPlus}
          label="Add an attachment"
          size={ACTION_SIZE}
          surface="solid"
          onPress={onAttach}
        />

        {/* A label, not a button — there's no picker behind it yet, and a
            control that does nothing is worse than a plain statement. */}
        <View style={styles.model}>
          <IconSparklesFilled size={13} color={colors.foregroundMuted} />
          <Text style={[typography.caption, { color: colors.foregroundMuted }]}>
            {model}
          </Text>
        </View>

        <View style={styles.spacer} />

        <IconButton
          icon={IconArrowUp}
          label="Send"
          size={ACTION_SIZE}
          surface="solid"
          active={trimmed.length > 0}
          disabled={trimmed.length === 0}
          onPress={submit}
        />
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: spacing.sm,
    gap: spacing.sm,
  },
  input: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    // Long messages scroll rather than growing the panel without limit.
    maxHeight: 120,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  model: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 1,
  },
  spacer: {
    flex: 1,
  },
});
