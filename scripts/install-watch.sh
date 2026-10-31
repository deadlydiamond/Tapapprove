#!/bin/zsh
# Installs a Debug build on the connected Apple Watch, for testing without TestFlight.
#
# Needs: watch/Signing.local.xcconfig, Developer Mode on the watch, its iPhone connected
# with a cable, and the relay reachable from the watch.
# Usage: scripts/install-watch.sh
set -uo pipefail

REPO=${0:A:h:h}
DERIVED=$REPO/watch/build/DerivedData-device

fail() { echo "FAILED: $1" >&2; exit 1; }

[[ -f $REPO/watch/Signing.local.xcconfig ]] || fail "copy watch/Signing.local.xcconfig.example to watch/Signing.local.xcconfig and fill it in"

DEVICES=$(mktemp)
xcrun devicectl list devices --json-output "$DEVICES" >/dev/null 2>&1
WATCH=$(node -e "
  const { devices } = JSON.parse(require('fs').readFileSync(process.argv[1])).result;
  const watch = devices.find((d) => d.hardwareProperties?.platform === 'watchOS' && d.hardwareProperties?.reality === 'physical');
  if (watch) console.log(watch.hardwareProperties.udid);
" "$DEVICES")
rm -f "$DEVICES"
[[ -n $WATCH ]] || fail "no Apple Watch found. Unlock it and connect its iPhone with a cable."
echo "Watch: $WATCH"

(cd "$REPO/watch" && xcodegen --quiet) || fail "xcodegen"
LOG=$(mktemp)
xcodebuild \
  -project "$REPO/watch/Tapapprove.xcodeproj" \
  -scheme Tapapprove \
  -configuration Debug \
  -destination "id=$WATCH" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  build >"$LOG" 2>&1 || { grep -E 'error:' "$LOG" | sort -u; fail "build. Full log: $LOG"; }
echo "Built and signed."

APP=$DERIVED/Build/Products/Debug-watchos/Tapapprove.app
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")
xcrun devicectl device install app --device "$WATCH" "$APP" || fail "install"
xcrun devicectl device process launch --device "$WATCH" "$BUNDLE_ID" || fail "launch. If the watch says the developer is untrusted, trust it in Settings, then open the app by hand."
echo "Installed and opened on the watch."
