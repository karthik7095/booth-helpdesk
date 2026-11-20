import { useKeyboardState } from "react-native-keyboard-controller";

/** Whether the software keyboard is currently on screen. */
export function useKeyboardVisible(): boolean {
  return useKeyboardState().isVisible;
}
