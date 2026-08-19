#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-all}"

case "$MODE" in
  all)
    docker compose up -d
    ;;
  redis-minio)
    docker compose -f docker-compose.redis-minio.yml up -d
    ;;
  *)
    echo "Usage: $0 [all|redis-minio]"
    exit 1
    ;;
esac

echo ""
echo "Redis:  redis://localhost:6380"
echo "MinIO:  http://localhost:9000  (console: http://localhost:9001)"
echo "        access key: minioadmin / secret: minioadmin"
echo "        bucket: inventory"
