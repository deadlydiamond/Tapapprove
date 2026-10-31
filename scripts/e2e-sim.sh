#!/bin/zsh
# End-to-end check: the real watch app in the Simulator, the real CLI and the local relay.
# The UI test acts as the person wearing the watch, this script as the computer.
#
# Needs: the relay running (cd relay && npx wrangler dev) and a watchOS Simulator runtime.
# Usage: scripts/e2e-sim.sh ["Apple Watch Series 11 (46mm)"]
set -uo pipefail

REPO=${0:A:h:h}
RELAY=http://localhost:8787
HANDOFF=/tmp/tapapprove-e2e
LOG=$HANDOFF/xcodebuild.log

fail() { echo "FAILED: $1" >&2; exit 1; }

curl -sf "$RELAY/healthz" >/dev/null || fail "no relay at $RELAY. Start it with: cd relay && npx wrangler dev"

DEVICE=${1:-$(xcrun simctl list devices available | grep -m1 'Apple Watch' | sed -E 's/^ *(.*) \([0-9A-F-]{36}\).*/\1/')}
[[ -n $DEVICE ]] || fail "no Apple Watch simulator found. Install one with: xcodebuild -downloadPlatform watchOS"
echo "Simulator: $DEVICE"

rm -rf "$HANDOFF"
mkdir -p "$HANDOFF"

# A throwaway HOME, so this run never touches the real Claude Code settings.
TEMP_HOME=$(mktemp -d)
cli() { HOME=$TEMP_HOME CLAUDE_CONFIG_DIR=$TEMP_HOME/.claude node "$REPO/cli/bin/tapapprove.mjs" "$@"; }

(cd "$REPO/watch" && xcodegen --quiet)
xcodebuild test \
  -project "$REPO/watch/Tapapprove.xcodeproj" \
  -scheme Tapapprove \
  -destination "platform=watchOS Simulator,name=$DEVICE" \
  -derivedDataPath "$REPO/watch/build/DerivedData" \
  -only-testing:TapapproveUITests \
  TAPAPPROVE_RELAY_URL="$RELAY" >"$LOG" 2>&1 &
XCODEBUILD=$!
trap 'kill $XCODEBUILD 2>/dev/null' EXIT

echo "Waiting for the watch to show a pairing code..."
for _ in {1..600}; do
  [[ -s $HANDOFF/code ]] && break
  kill -0 $XCODEBUILD 2>/dev/null || { tail -30 "$LOG"; fail "xcodebuild stopped before the app showed a code"; }
  sleep 0.5
done
[[ -s $HANDOFF/code ]] || fail "the watch never showed a pairing code"
CODE=$(<"$HANDOFF/code")
echo "Pairing with code $CODE"
cli pair "$CODE" --relay "$RELAY" --name "E2E Mac" || fail "pair"
cli status || fail "status"

LONG_COMMAND="echo start; $(printf 'echo this-line-makes-the-command-long; %.0s' {1..30})echo end"
VERY_LONG_COMMAND="echo start; $(printf 'echo this-line-makes-the-command-long; %.0s' {1..200})echo end"
NEAR_LIMIT_COMMAND="echo start; $(printf 'echo this-line-makes-the-command-long; %.0s' {1..2450})echo end"
echo "Long request: the watch must scroll to the end, then approve"
cli test --timeout 120 --command "$LONG_COMMAND"
[[ $? == 0 ]] || fail "the long request should have been approved (exit 0)"

echo "Short request with a session answer: the watch allows it for this session"
OUTPUT=$(cli test --timeout 120 --command 'ls -la' --session-label 'Yes, allow ls for this session')
[[ $? == 0 ]] || fail "the session answer should have approved (exit 0)"
[[ $OUTPUT == *"for this session"* ]] || fail "the computer never heard which answer was chosen: $OUTPUT"
echo "$OUTPUT"

echo "Short request: the watch denies"
cli test --timeout 120 --command 'ls -la'
[[ $? == 1 ]] || fail "the short request should have been denied (exit 1)"

echo "Very long request: it arrives whole, the watch scrolls to the end, then approves"
cli test --timeout 300 --command "$VERY_LONG_COMMAND"
[[ $? == 0 ]] || fail "the very long request should have been approved (exit 0)"

echo "Request near the limit: the app stays responsive, the watch denies"
cli test --timeout 120 --command "$NEAR_LIMIT_COMMAND"
[[ $? == 1 ]] || fail "the request near the limit should have been denied (exit 1)"

trap - EXIT
wait $XCODEBUILD
RESULT=$?
grep -E '(error|warning):|Test Case .*(passed|failed)|\*\* TEST' "$LOG" | sort -u
[[ $RESULT == 0 ]] || fail "the UI test failed. Full log: $LOG"
echo "PASSED. Screenshots: $HANDOFF"
