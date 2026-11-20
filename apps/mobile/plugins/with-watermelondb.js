const {
  withAppBuildGradle,
  withMainApplication,
  withSettingsGradle,
} = require("expo/config-plugins");

/**
 * WatermelonDB's bridge module autolinks (it ships react-native.config.js), but
 * its JSI module does not — that one has to be included as a Gradle project and
 * registered as a package by hand. Doing it here rather than in android/ keeps
 * it alive across `expo prebuild --clean`.
 *
 * JSI is not optional for us: `unsafeTurbo`, the only first-sync mode that can
 * take 296k rows, requires it.
 */
const JSI_PROJECT = `
include ':watermelondb-jsi'
project(':watermelondb-jsi').projectDir = new File(rootProject.projectDir, '../../../node_modules/@nozbe/watermelondb/native/android-jsi')
`;

function withSettings(config) {
  return withSettingsGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes("':watermelondb-jsi'")) {
      cfg.modResults.contents += JSI_PROJECT;
    }
    return cfg;
  });
}

function withAppGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    const dependency = "    implementation project(':watermelondb-jsi')";

    if (!cfg.modResults.contents.includes(dependency)) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        (match) => `${match}\n${dependency}`,
      );
    }

    return cfg;
  });
}

function withPackage(config) {
  return withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;

    if (!contents.includes("WatermelonDBJSIPackage")) {
      contents = contents.replace(
        /^(package .*)$/m,
        "$1\n\nimport com.nozbe.watermelondb.jsi.WatermelonDBJSIPackage",
      );
      // The generated list is `PackageList(this).packages.apply { ... }`.
      contents = contents.replace(
        /(PackageList\(this\)\.packages\.apply \{)/,
        "$1\n              add(WatermelonDBJSIPackage())",
      );
    }

    cfg.modResults.contents = contents;
    return cfg;
  });
}

module.exports = function withWatermelonDB(config) {
  return withPackage(withAppGradle(withSettings(config)));
};
