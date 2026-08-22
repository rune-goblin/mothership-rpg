# Where Foundry itself lives. Sourced, not run: it sets FOUNDRY_APP or exits with its own message.
# Shared so the preflight and the launcher can never disagree about which app the harness boots.

if [ -z "${FOUNDRY_APP:-}" ]; then
    for candidate in \
        "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app" \
        "/Applications/Foundry Virtual Tabletop v${FOUNDRY_VERSION:-14}.app/Contents/Resources/app"; do
        if [ -f "$candidate/main.js" ]; then
            FOUNDRY_APP="$candidate"
            break
        fi
    done
fi

if [ -z "${FOUNDRY_APP:-}" ] || [ ! -f "$FOUNDRY_APP/main.js" ]; then
    echo "❌ Foundry app not found. Set FOUNDRY_APP to the dir containing main.js" >&2
    echo "   (e.g. '/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app')." >&2
    exit 1
fi
