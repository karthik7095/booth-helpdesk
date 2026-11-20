const { withAndroidManifest } = require("expo/config-plugins");

/**
 * react-native-bluetooth-classic autolinks (it ships react-native.config.js)
 * but has no config plugin, so the manifest permissions it needs have to be
 * declared here — in app.json rather than android/, which is regenerated.
 *
 * Android split these in two at API 31: BLUETOOTH/BLUETOOTH_ADMIN are
 * install-time permissions capped at API 30, and BLUETOOTH_SCAN/CONNECT are
 * runtime permissions above it. ACCESS_FINE_LOCATION is only there because
 * discovery on API <= 30 refuses to return devices without it; `neverForLocation`
 * on the scan permission is what excuses us from asking for it on API 31+.
 *
 * It is declared without an API cap because the app also reports the user's
 * GPS position (expo-location); capped at 30, Android 12+ phones would only
 * ever grant coarse, kilometre-level location.
 */
const PERMISSIONS = [
  { name: "android.permission.BLUETOOTH", maxSdkVersion: "30" },
  { name: "android.permission.BLUETOOTH_ADMIN", maxSdkVersion: "30" },
  { name: "android.permission.BLUETOOTH_SCAN", flags: "neverForLocation" },
  { name: "android.permission.BLUETOOTH_CONNECT" },
  { name: "android.permission.ACCESS_FINE_LOCATION" },
];

module.exports = function withBluetoothClassic(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const names = PERMISSIONS.map((permission) => permission.name);

    const existing = (manifest["uses-permission"] ?? []).filter(
      (permission) => !names.includes(permission.$?.["android:name"]),
    );

    manifest["uses-permission"] = [
      ...existing,
      ...PERMISSIONS.map(({ name, maxSdkVersion, flags }) => ({
        $: {
          "android:name": name,
          ...(maxSdkVersion ? { "android:maxSdkVersion": maxSdkVersion } : {}),
          ...(flags ? { "android:usesPermissionFlags": flags } : {}),
        },
      })),
    ];

    return cfg;
  });
};
