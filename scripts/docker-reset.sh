#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-all}"

case "$MODE" in
  all)
    docker compose down -v
    docker compose up -d
    ;;
  redis-minio)
    docker compose -f docker-compose.redis-minio.yml down -v
    docker compose -f docker-compose.redis-minio.yml up -d
    ;;
  *)
    echo "Usage: $0 [all|redis-minio]"
    exit 1
    ;;
esac

echo "Docker volumes recreated."
