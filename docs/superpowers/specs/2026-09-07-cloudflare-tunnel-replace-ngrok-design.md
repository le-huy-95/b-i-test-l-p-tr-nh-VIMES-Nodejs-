# Cloudflare Tunnel thay ngrok (path routing notification-ws)

**Date:** 2026-09-07  
**Status:** Approved (draft for review)

## Goal

Bỏ phụ thuộc ngrok. Public domain cố định `*.kimbap.io.vn` qua Cloudflare Tunnel.  
Flutter chỉ cần một API host: `api.kimbap.io.vn` cho cả business API + notification REST/WS.

## Decision

**Option B + Approach 2:** path-based routing trên cùng hostname `api.kimbap.io.vn`.

| Path (regex) | Origin |
|--------------|--------|
| `^/notifications` | `http://localhost:3001` (notification-ws) |
| `^/socket.io` | `http://localhost:3001` |
| `^/api/v1/notifications` | `http://localhost:3001` |
| còn lại trên `api.kimbap.io.vn` | `http://localhost:3004` (backend) |

Hostnames giữ nguyên:

| Hostname | Origin |
|----------|--------|
| `api.kimbap.io.vn` | path rules ở trên |
| `webhook.kimbap.io.vn` | `http://localhost:3004` |
| `storage.kimbap.io.vn` | `http://localhost:9000` (MinIO) |

## Flutter public URLs

```
API base:     https://api.kimbap.io.vn/api/v1
Notif REST:   https://api.kimbap.io.vn/api/v1/notifications
Notif WS:     wss://api.kimbap.io.vn/notifications?token=<JWT>
Storage:      https://storage.kimbap.io.vn
Webhook:      https://webhook.kimbap.io.vn  (Facebook only; app không cần)
```

## Repo changes

1. `scripts/cloudflared/config.yml.example` — thêm path rules cho `:3001`
2. `scripts/cloudflared/install-macos-service.sh` — ghi cùng ingress khi cài LaunchAgent
3. Đồng bộ `~/.cloudflared/config.yml` + restart cloudflared service
4. Nếu tunnel **remotely managed** (chạy bằng token): cấu hình Public Hostname / path tương đương trên Cloudflare Zero Trust dashboard (local ingress có thể bị ignore)
5. `scripts/dev-ngrok-proxy.mjs` — đổi tên / comment thành fallback `dev-tunnel-proxy` (không còn ngrok); chỉ dùng nếu path routing WS fail
6. Docs notification (`docs/NOTIFICATION_*.md`) — thay `localhost:3001` bằng public URL ở trên
7. `.env.example` — gợi ý `APP_PUBLIC_URL` / `MINIO_PUBLIC_URL` theo domain

## Fallback (Approach 1)

Nếu WebSocket upgrade qua path rule cloudflared lỗi:

- Chạy proxy local `:3080` (API 3004 + WS 3001 theo path như `dev-ngrok-proxy.mjs`)
- Tunnel: `api.kimbap.io.vn` → `http://localhost:3080`
- Flutter URLs **không đổi**

## Out of scope

- Hostname riêng `notif.kimbap.io.vn`
- Đổi port local backend / notification-ws
- Deploy production ngoài máy Mac hiện tại
- Commit secrets (`tunnel-token`, credentials)

## Verify

1. `curl -sS https://api.kimbap.io.vn/api/v1/health` → backend OK  
2. `curl -sS https://api.kimbap.io.vn/health` với path notif (nếu expose) hoặc REST notif có auth  
3. Flutter/WS: `wss://api.kimbap.io.vn/notifications?token=...` nhận `NOTIFICATION_NEW`  
4. `https://storage.kimbap.io.vn/...` load object MinIO  
