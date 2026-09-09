/**
 * Clash/Surge thường inject HTTP(S)_PROXY=http://127.0.0.1:port vào shell của IDE.
 * Khi proxy chết hoặc làm DNS lệch, verify Google ID token (fetch certs/tokeninfo)
 * fail với ENOTFOUND và API trả 401 "Invalid or expired Google ID token" gây hiểu nhầm.
 */
const PROXY_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
] as const;

const LOCAL_PROXY_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\b/i;

/** Xóa biến proxy trỏ về localhost để Node resolve DNS trực tiếp (Google/Firebase/SMTP). */
export function clearLocalhostProxyEnv(): void {
  const cleared: string[] = [];
  for (const key of PROXY_KEYS) {
    const value = process.env[key];
    if (!value) continue;
    if (LOCAL_PROXY_RE.test(value)) {
      delete process.env[key];
      cleared.push(key);
    }
  }
  if (cleared.length > 0) {
    console.warn(
      `[net] Cleared localhost proxy env (${cleared.join(", ")}) so Google/Firebase and SMTP can resolve DNS`,
    );
  }
}
