#!/bin/bash
# What `npm run test:e2e` needs before it spends a build on finding out. Every check here fails
# for a reason no later step can recover from, and each one names what to do about it.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${TEST_FOUNDRY_PORT:-30005}"

# The suite re-packs the compendia and re-clones the system out of Foundry's own Data dir, and
# Foundry holds an exclusive LevelDB lock on every pack it can see — this repo's included, because
# `npm run setup` links it in there. The harness's *server* is happy beside a running Foundry: it
# serves its own data dir on its own port. So a tree already built and packed can skip the rebuild.
if [[ -z "${ALLOW_FOUNDRY_RUNNING:-}" ]] && pgrep -f "Foundry Virtual Tabletop" >/dev/null 2>&1; then
  echo "❌ Foundry is running, so the packs cannot be rebuilt — it holds the LevelDB lock." >&2
  echo "   Close it and re-run, or, if dist/ and packs/ are already current, run the" >&2
  echo "   suite on its own:  npm run test:e2e:run" >&2
  exit 1
fi

# shellcheck source=scripts/foundry-app.sh
source "$REPO_ROOT/scripts/foundry-app.sh"

# A port that answers is a test server Playwright will reuse (`reuseExistingServer`). One that is
# held by something silent is a squatter, and the only sign of it is `webServer was not able to
# start` two minutes later, which names nothing.
if lsof -ti:"$PORT" >/dev/null 2>&1 && ! curl -sf -m 5 -o /dev/null "http://127.0.0.1:$PORT"; then
  echo "❌ Port $PORT is held by something that is not answering." >&2
  echo "   Stop it first:  lsof -ti:$PORT | xargs kill" >&2
  exit 1
fi

echo "✓ preflight: app at $FOUNDRY_APP, port $PORT usable"
