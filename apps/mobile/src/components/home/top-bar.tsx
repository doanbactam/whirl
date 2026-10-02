import { Pressable, StyleSheet, Text, View } from "react-native";
import { IconPencilPlus, IconSpy } from "@tabler/icons-react-native";
import type { SharedValue } from "react-native-reanimated";

import { AvatarButton } from "@/components/ui/avatar-button";
import { IconButton } from "@/components/ui/icon-button";
import { TabStrip, type Tab } from "@/components/home/tab-strip";
import { spacing, typography, useTheme } from "@/lib/theme";

type TopBarProps = {
  tabs: readonly Tab[];
  progress: SharedValue<number>;
  activeIndex: number;
  onSelectTab: (index: number) => void;
  onNewThread: () => void;
  avatarUri?: string | null;
  initials: string;
  onOpenAccount: () => void;
  /**
   * The right-hand button is the incognito toggle while the open thread is
   * still empty, and a new-thread button everywhere else — there's nothing to
   * make private about a thread you haven't started.
   */
  showIncognito: boolean;
  incognito: boolean;
  onToggleIncognito: () => void;
};

/**
 * Avatar, strip and action all share one row, so the buttons have to give the
 * strip most of the width — it carries a thread title that can be any length.
 */
const CONTROL = 44;

export function TopBar({
  tabs,
  progress,
  activeIndex,
  onSelectTab,
  onNewThread,
  avatarUri,
  initials,
  onOpenAccount,
  showIncognito,
  incognito,
  onToggleIncognito,
}: TopBarProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.bar}>
      <AvatarButton
        uri={avatarUri}
        initials={initials}
        label="Your account"
        size={CONTROL}
        onPress={onOpenAccount}
      />

      <TabStrip
        tabs={tabs}
        progress={progress}
        activeIndex={activeIndex}
        onSelect={onSelectTab}
        trailing={
          /* Sits in the strip but never takes the pill: it starts a thread
             rather than moving to one. */
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New thread"
            hitSlop={spacing.sm}
            onPress={onNewThread}
            style={styles.new}
          >
            <Text style={[typography.label, { color: colors.foregroundMuted }]}>
              + New
            </Text>
          </Pressable>
        }
      />

      {/* One button in two jobs. Handing it both glyphs, rather than swapping
          the whole control, lets one glyph replace the other in place. */}
      <IconButton
        icon={showIncognito ? IconSpy : IconPencilPlus}
        iconName={showIncognito ? "incognito" : "new-thread"}
        label={
          showIncognito
            ? incognito
              ? "Turn off incognito"
              : "Turn on incognito"
            : "New thread"
        }
        size={CONTROL}
        active={showIncognito && incognito}
        onPress={showIncognito ? onToggleIncognito : onNewThread}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  new: {
    paddingHorizontal: spacing.sm,
  },
});
