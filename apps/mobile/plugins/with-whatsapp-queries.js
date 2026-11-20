const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Android 11 hides other installed apps from us unless they are declared here.
 * Without this the share module cannot see WhatsApp, so "Text With Image" would
 * report it as missing on every phone running API 30 or above.
 */
const PACKAGES = ["com.whatsapp", "com.whatsapp.w4b"];

module.exports = function withWhatsAppQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const queries = manifest.queries?.[0] ?? {};
    const existing = (queries.package ?? []).filter(
      (entry) => !PACKAGES.includes(entry.$?.["android:name"]),
    );

    manifest.queries = [
      {
        ...queries,
        package: [
          ...existing,
          ...PACKAGES.map((name) => ({ $: { "android:name": name } })),
        ],
      },
      ...(manifest.queries ?? []).slice(1),
    ];

    return cfg;
  });
};
