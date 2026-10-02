import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import {
  Button,
  ContextMenu as NativeMenu,
  Host,
  RNHostView,
  type ButtonProps,
} from "@expo/ui/swift-ui";
import { disabled as disabledModifier } from "@expo/ui/swift-ui/modifiers";

import type { MenuAction } from "@/lib/menu";
import { useTheme } from "@/lib/theme";

type ContextMenuProps = {
  actions: MenuAction[];
  /**
   * The row's height. SwiftUI proposes a size to the React Native content it
   * hosts rather than measuring it, so the host has to be told how tall the
   * thing inside it is — a host with no height collapses and takes the row's
   * hit area with it.
   */
  height: number;
  children: ReactElement;
};

/**
 * A long press that opens the system menu — the real one, with the material
 * and the lift and the haptic UIKit gives it for free.
 *
 * The row itself is still React Native: `Host` hands the RN view to SwiftUI as
 * the menu's trigger, which is also what UIKit snapshots for the preview that
 * floats above the menu. So the thing that lifts under the finger is the row
 * the user pressed, not an approximation of it.
 */
export function ContextMenu({ actions, height, children }: ContextMenuProps) {
  const { scheme } = useTheme();

  return (
    <Host
      style={[styles.host, { height }]}
      /* The app themes off `useColorScheme`; the SwiftUI subtree reads the
         system on its own unless it's told the same thing. */
      colorScheme={scheme}
      /* The menu is presented from inside a scrolling list, nowhere near a
         screen edge — insets here would only push the row around. */
      ignoreSafeArea="all"
    >
      <NativeMenu>
        {/* The row goes through `RNHostView` rather than straight into the
            slot: that's what attaches a touch handler to the hosted view, and
            without it the SwiftUI subtree swallows every tap — the menu would
            open on a long press but the row would no longer open a thread. */}
        <NativeMenu.Trigger>
          <RNHostView>{children}</RNHostView>
        </NativeMenu.Trigger>
        <NativeMenu.Items>
          {actions.map((action) => (
            <Button
              key={action.key}
              label={action.label}
              /* The menu takes an SF Symbol name. Its type is the full symbol
                 union, which ships in a package this app doesn't install, so
                 the name is carried as a plain string and handed over here. */
              systemImage={action.systemImage as ButtonProps["systemImage"]}
              role={action.destructive ? "destructive" : "default"}
              modifiers={action.disabled ? [disabledModifier(true)] : undefined}
              onPress={action.onPress}
            />
          ))}
        </NativeMenu.Items>
      </NativeMenu>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: {
    alignSelf: "stretch",
  },
});
