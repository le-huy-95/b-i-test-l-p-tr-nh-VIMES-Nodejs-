#!/usr/bin/env bash
set -euo pipefail

CLOUDFLARED="${CLOUDFLARED:-/opt/homebrew/bin/cloudflared}"
CONFIG_DIR="${HOME}/.cloudflared"
CONFIG_FILE="${CONFIG_DIR}/config.yml"
TOKEN_FILE="${CONFIG_DIR}/tunnel-token"
PLIST="${HOME}/Library/LaunchAgents/com.cloudflare.cloudflared.kimbap.plist"
LABEL="com.cloudflare.cloudflared.kimbap"
BACKEND_PORT="${BACKEND_PORT:-3004}"

if ! command -v "${CLOUDFLARED}" >/dev/null 2>&1; then
  echo "cloudflared not found. Install with: brew install cloudflared" >&2
  exit 1
fi

if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "Missing ${TOKEN_FILE}" >&2
  echo "Save your tunnel token from Cloudflare Zero Trust -> Networks -> Tunnels" >&2
  exit 1
fi

mkdir -p "${CONFIG_DIR}" "${HOME}/Library/LaunchAgents"

cat > "${CONFIG_FILE}" <<EOF
ingress:
  - hostname: api.kimbap.io.vn
    service: http://localhost:${BACKEND_PORT}
  - hostname: webhook.kimbap.io.vn
    service: http://localhost:${BACKEND_PORT}
  - service: http://localhost:${BACKEND_PORT}
EOF

cat > "${PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${CLOUDFLARED}</string>
        <string>tunnel</string>
        <string>--config</string>
        <string>${CONFIG_FILE}</string>
        <string>--no-autoupdate</string>
        <string>run</string>
        <string>--token-file</string>
        <string>${TOKEN_FILE}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${HOME}/Library/Logs/cloudflared-kimbap.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/Library/Logs/cloudflared-kimbap.err.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "${PLIST}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${PLIST}"

echo "Cloudflare tunnel service installed."
echo "Logs: ${HOME}/Library/Logs/cloudflared-kimbap.log"
echo "Test: curl https://api.kimbap.io.vn/api/v1/health"
