#!/usr/bin/env bash
set -euo pipefail

CLOUDFLARED="${CLOUDFLARED:-/opt/homebrew/bin/cloudflared}"
CONFIG_FILE="${HOME}/.cloudflared/config.yml"
TOKEN_FILE="${HOME}/.cloudflared/tunnel-token"

if ! command -v "${CLOUDFLARED}" >/dev/null 2>&1; then
  echo "cloudflared not found. Install with: brew install cloudflared" >&2
  exit 1
fi

if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "Missing ${TOKEN_FILE}" >&2
  exit 1
fi

exec "${CLOUDFLARED}" tunnel \
  --config "${CONFIG_FILE}" \
  --no-autoupdate \
  run \
  --token-file "${TOKEN_FILE}"
