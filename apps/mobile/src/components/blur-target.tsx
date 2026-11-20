import { BlurTargetView } from "expo-blur";
import { createContext, useContext, useRef, type ReactNode, type RefObject } from "react";
import type { View } from "react-native";

/**
 * expo-blur 57 changed the Android API: a BlurView blurs the `BlurTargetView`
 * it is pointed at, and with no target the native view silently falls back to
 * a flat translucent square. So the app content is wrapped in one target and
 * overlays (dialogs) read the ref from here.
 */
const BlurTargetContext = createContext<RefObject<View | null> | null>(null);

export function BlurTargetProvider({ children }: { children: ReactNode }) {
  const ref = useRef<View | null>(null);

  return (
    <BlurTargetContext.Provider value={ref}>
      <BlurTargetView ref={ref} style={{ flex: 1 }}>
        {children}
      </BlurTargetView>
    </BlurTargetContext.Provider>
  );
}

export function useBlurTarget() {
  return useContext(BlurTargetContext) ?? undefined;
}
