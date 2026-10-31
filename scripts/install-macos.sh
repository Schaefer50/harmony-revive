#!/usr/bin/env bash
# Builds Harmony Revive and installs it as a macOS LaunchAgent so the server
# starts at login and restarts if it crashes.
#
#   ./scripts/install-macos.sh 10.0.0.26            # one hub
#   ./scripts/install-macos.sh 10.0.0.26,10.0.0.27  # several hubs
#   ./scripts/install-macos.sh --uninstall

set -euo pipefail

LABEL="com.harmonyrevive.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/harmony-revive.log"
PORT="${PORT:-8787}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="gui/$(id -u)"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Harmony Revive stopped and removed from login items. Your hub list is kept in $REPO/data."
  exit 0
fi

HUBS="${1:-}"
if [[ -z "$HUBS" ]]; then
  echo "Usage: $0 <hub-ip>[,<hub-ip>...]   (e.g. $0 10.0.0.26)" >&2
  exit 1
fi

NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "Node.js is not installed. Install it with 'brew install node' or from https://nodejs.org, then re-run." >&2
  exit 1
fi
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 20 )); then
  echo "Node.js 20 or newer is required (found $("$NODE" --version))." >&2
  exit 1
fi

echo "Building Harmony Revive…"
cd "$REPO"
npm ci --no-audit --no-fund
npm run build

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$REPO/data"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/server/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HARMONY_HUBS</key><string>$HUBS</string>
    <key>PORT</key><string>$PORT</string>
    <key>DATA_DIR</key><string>$REPO/data</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"

sleep 2
HOSTNAME_LOCAL="$(scutil --get LocalHostName 2>/dev/null || hostname -s).local"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '<this-mac-ip>')"

echo
if curl -fsS "http://localhost:$PORT/api/hubs" >/dev/null 2>&1; then
  echo "Harmony Revive is running."
else
  echo "The server did not answer yet. Check the log: $LOG"
fi
echo "Open on your phone (same Wi-Fi):"
echo "  http://$HOSTNAME_LOCAL:$PORT"
echo "  http://$IP:$PORT"
echo "Log: $LOG"
