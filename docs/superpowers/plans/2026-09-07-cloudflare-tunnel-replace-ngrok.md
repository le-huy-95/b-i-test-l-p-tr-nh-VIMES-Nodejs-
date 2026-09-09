# Cloudflare Tunnel Replace Ngrok Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route API + notification-ws under `api.kimbap.io.vn` via Cloudflare Tunnel path rules; remove ngrok dependency; document Flutter public URLs.

**Architecture:** cloudflared ingress path-matches `/notifications`, `/socket.io`, `/api/v1/notifications` → `:3001`; all other `api` traffic → `:3004`. Fallback local proxy kept under a non-ngrok name if WS path routing fails.

**Tech Stack:** cloudflared, bash install scripts, Node HTTP proxy fallback, markdown docs

---

### Task 1: Update cloudflared example + install script

**Files:**
- Modify: `scripts/cloudflared/config.yml.example`
- Modify: `scripts/cloudflared/install-macos-service.sh`

- [ ] **Step 1: Replace example ingress with path rules**

```yaml
# Copy to ~/.cloudflared/config.yml
# Origin ports: backend 3004, notification-ws 3001, MinIO 9000

ingress:
  - hostname: api.kimbap.io.vn
    path: ^/notifications
    service: http://localhost:3001
  - hostname: api.kimbap.io.vn
    path: ^/socket.io
    service: http://localhost:3001
  - hostname: api.kimbap.io.vn
    path: ^/api/v1/notifications
    service: http://localhost:3001
  - hostname: api.kimbap.io.vn
    service: http://localhost:3004
  - hostname: webhook.kimbap.io.vn
    service: http://localhost:3004
  - hostname: storage.kimbap.io.vn
    service: http://localhost:9000
  - service: http_status:404
```

- [ ] **Step 2: Mirror the same ingress block in `install-macos-service.sh` heredoc** (keep `BACKEND_PORT` for `:3004` catch-all; hardcode `3001` for notif paths; change catch-all from backend to `http_status:404`).

---

### Task 2: Rename ngrok proxy to tunnel fallback

**Files:**
- Create: `scripts/dev-tunnel-proxy.mjs` (same content as current proxy; comment says tunnel fallback on `:3080`)
- Delete: `scripts/dev-ngrok-proxy.mjs`

- [ ] **Step 1: Write `scripts/dev-tunnel-proxy.mjs`** with header:

```js
/**
 * Dev reverse proxy: one port → API (3004) + notification-ws (3001).
 * Fallback when Cloudflare Tunnel path routing for WS is unavailable.
 * Point tunnel hostname api.kimbap.io.vn → http://localhost:3080
 */
```

Keep routing logic identical to `dev-ngrok-proxy.mjs`.

- [ ] **Step 2: Delete `scripts/dev-ngrok-proxy.mjs`**

---

### Task 3: Docs + env example

**Files:**
- Modify: `docs/NOTIFICATION_FRONTEND_GUIDE.md` (base URL section)
- Modify: `docs/NOTIFICATION_WS.md` (public URL note if present)
- Modify: `docs/NOTIFICATION_FRONTEND_WEBSOCKET_GUIDE.md` (WS URL)
- Modify: `.env.example` (`APP_PUBLIC_URL`, `MINIO_PUBLIC_URL` comments/defaults for tunnel)

- [ ] **Step 1: Set public base URLs in notification docs**

```
REST:  https://api.kimbap.io.vn/api/v1/notifications
WS:    wss://api.kimbap.io.vn/notifications?token=<JWT_ACCESS_TOKEN>
Local: http://localhost:3001 (dev without tunnel)
```

- [ ] **Step 2: In `.env.example`**

```
APP_PUBLIC_URL=https://api.kimbap.io.vn
MINIO_PUBLIC_URL=https://storage.kimbap.io.vn
```

(keep localhost acceptable as comment alternative)

---

### Task 4: Apply live config + restart cloudflared

**Files:**
- Modify (host): `~/.cloudflared/config.yml`

- [ ] **Step 1: Write updated `~/.cloudflared/config.yml` matching example**
- [ ] **Step 2: Restart LaunchAgent** `com.cloudflare.cloudflared.kimbap` via `launchctl kickstart -k` or re-run install script
- [ ] **Step 3: If tunnel is remotely managed (token) and path rules ignored:** document that dashboard Public Hostname path must be set; temporarily set `api` service to `http://localhost:3080` and run `node scripts/dev-tunnel-proxy.mjs`

---

### Task 5: Verify

- [ ] **Step 1:** `curl -sS -o /dev/null -w "%{http_code}" https://api.kimbap.io.vn/api/v1/health` → expect `200` (or existing health path)
- [ ] **Step 2:** Confirm notification path reaches `:3001` (auth 401 without token is OK; must not hit business API 404)
- [ ] **Step 3:** Report Flutter URLs to user

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Path rules api → 3001/3004 | 1, 4 |
| webhook/storage hostnames | 1, 4 |
| Rename/remove ngrok proxy | 2 |
| Docs + env | 3 |
| Fallback proxy | 2, 4 |
| Verify | 5 |
