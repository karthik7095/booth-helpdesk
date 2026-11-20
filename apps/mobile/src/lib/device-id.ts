import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";

/**
 * A random id for this install of the app, sent with every request so an
 * admin can block the phone along with a deactivated user. It lives in the
 * app's own storage, so uninstalling the app takes it away and a reinstall
 * starts with a new one — which is what lifts the phone block.
 */
const DEVICE_KEY = "voter.device.id";

let cached: Promise<string | null> | null = null;

async function readOrCreate(): Promise<string | null> {
  try {
    const stored = await SecureStore.getItemAsync(DEVICE_KEY);

    if (stored) return stored;

    const id = randomUUID();
    await SecureStore.setItemAsync(DEVICE_KEY, id);

    return id;
  } catch {
    return null;
  }
}

export function deviceId(): Promise<string | null> {
  cached ??= readOrCreate().then((id) => {
    // Retried on the next request if storage was not ready this time.
    if (!id) cached = null;
    return id;
  });

  return cached;
}
