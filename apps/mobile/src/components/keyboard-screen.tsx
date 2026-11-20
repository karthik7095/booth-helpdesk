import { type ReactNode } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * A scrolling screen that keeps the focused field above the keyboard.
 *
 * This is Expo's recommended approach for forms with several inputs: the
 * keyboard-controller library tracks the keyboard frame natively and scrolls
 * the focused input into view, which hand-rolled measuring could not do
 * reliably on devices whose window does not resize.
 */
export function KeyboardScreen({
  children,
  center = false,
  contentContainerStyle,
  extraBottom = 24,
}: {
  children: ReactNode;
  /** Centre the content vertically when it is shorter than the screen. */
  center?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  extraBottom?: number;
}) {
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAwareScrollView
      className="flex-1"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      // Space kept between the focused field and the top of the keyboard.
      bottomOffset={24}
      contentContainerStyle={[
        {
          flexGrow: 1,
          justifyContent: center ? "center" : "flex-start",
          paddingBottom: insets.bottom + extraBottom,
        },
        contentContainerStyle,
      ]}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
