#!/usr/bin/env bash
#
# Builds the Booth Help Desk Android APK locally into
# apps/mobile/Booth-Help-Desk.apk:
#
#   npm run mobile:apk
#   npm run mobile:apk -- --clean   # regenerate apps/mobile/android first
#
# Built for arm64-v8a and armeabi-v7a (64- and 32-bit phones); the x86
# emulator libraries are left out, which roughly halves the APK. Signed with
# the debug keystore that `expo prebuild` sets up.
set -euo pipefail

MOBILE="$(cd "$(dirname "$0")/../apps/mobile" && pwd)"
cd "$MOBILE"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export NODE_ENV=production CI=1 EXPO_NO_GIT_STATUS=1
export EXPO_PUBLIC_API_URL=https://voters.nabeenmultimedia.com/backend
export EXPO_PUBLIC_MSG91_WIDGET_ID=366a6e6a3059373336313133
export EXPO_PUBLIC_MSG91_TOKEN_AUTH=581545TRrxqlHo6acf554dP1

if [[ "${1:-}" == --clean || ! -d android ]]; then
  npx expo prebuild -p android --clean --no-install
fi

# EXPO_PUBLIC_* values are inlined when Metro transforms a file, and neither
# Metro's cache nor Gradle's up-to-date check notices when they change, so
# always bundle from scratch.
rm -rf "${TMPDIR:-/tmp}"/metro-* "${TMPDIR:-/tmp}"/haste-map-* android/app/build/generated
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a)
cp android/app/build/outputs/apk/release/app-release.apk Booth-Help-Desk.apk
printf '\n✓ %s (%s)\n' "$MOBILE/Booth-Help-Desk.apk" "$(du -h Booth-Help-Desk.apk | cut -f1)"
