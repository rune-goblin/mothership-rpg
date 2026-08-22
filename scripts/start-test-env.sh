#!/bin/bash
# Boot Foundry headlessly against test/foundry-data, auto-launching a world. Used by the
# Playwright harness, and handy for manual poking.
#
# Override the app location with FOUNDRY_APP=<dir containing main.js>.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_DATA="$REPO_ROOT/test/foundry-data"
PORT="${TEST_FOUNDRY_PORT:-30005}"
FOUNDRY_VERSION="${FOUNDRY_VERSION:-14}"

# Re-clone systems/worlds before every boot. Idempotent and cheap (copy-on-write), and it keeps
# the isolated tree from drifting behind a system update. Skip with TEST_FOUNDRY_SKIP_SETUP=1.
if [ "${TEST_FOUNDRY_SKIP_SETUP:-0}" != "1" ]; then
    (cd "$REPO_ROOT" && TEST_FOUNDRY_PORT="$PORT" node scripts/setup-test-env.ts)
elif [ ! -f "$TEST_DATA/Config/options.json" ]; then
    echo "❌ Test data path not initialized at $TEST_DATA"
    echo "   Run: npm run test:e2e:setup"
    exit 1
fi

# shellcheck source=scripts/foundry-app.sh
source "$REPO_ROOT/scripts/foundry-app.sh"

# Foundry locks its data directory and releases the lock only on a clean exit. Anything that
# kills it — `kill -9`, a Playwright teardown, ^C at the wrong moment — leaves the lock behind,
# and the next boot dies with "already locked by another process". Through Playwright that
# surfaces as `webServer was not able to start. Exit code: 1`, which names nothing.
#
# This tree is the harness's alone and is re-cloned on every boot, so a lock with nothing
# listening on the port belongs to a process that is gone. The lock is a *directory* — an atomic
# mkdir — so it is tested with -e and removed with -r.
LOCK="$TEST_DATA/Config/options.json.lock"
if [ -e "$LOCK" ]; then
    if lsof -ti:"$PORT" >/dev/null 2>&1; then
        echo "❌ Something is already serving port $PORT against $TEST_DATA."
        echo "   Stop it first:  lsof -ti:$PORT | xargs kill"
        exit 1
    fi
    echo "🔓 cleared a stale data-dir lock (left by a killed run; nothing is on port $PORT)"
    rm -rf "$LOCK"
fi

cd "$FOUNDRY_APP"

ARGS=(--dataPath="$TEST_DATA" --port="$PORT" --noupnp)

if [ -n "${TEST_WORLD:-}" ]; then
    ARGS+=(--world="$TEST_WORLD")
    echo "Auto-launching world: $TEST_WORLD"
fi

echo "Starting Foundry from $FOUNDRY_APP on port $PORT"
exec node main.js "${ARGS[@]}"
