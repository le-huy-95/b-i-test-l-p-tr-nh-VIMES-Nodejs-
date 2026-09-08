/**
 * Tích hợp Firebase Admin và xác thực Google ID Token.
 *
 * Hỗ trợ nhiều chiến lược verify token (theo thứ tự ưu tiên):
 * 1. Verify cục bộ bằng public cert của Firebase (không cần gọi Admin SDK mỗi request)
 * 2. Firebase Admin SDK (khi có service account file)
 * 3. Google tokeninfo endpoint (fallback cuối)
 *
 * Dùng cho luồng đăng nhập Google/Firebase từ client (Flutter, web).
 */
import fs from "fs";
import path from "path";
import jwt, { type JwtHeader, type JwtPayload } from "jsonwebtoken";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { env } from "./env";

/** Promise khởi tạo Firebase Admin — chỉ chạy một lần (singleton) */
let initPromise: Promise<void> | null = null;

/** Cache chứng chỉ x509 công khai của Firebase để verify JWT offline */
let certCache: { expiresAt: number; certs: Record<string, string> } | null =
  null;

/** URL metadata chứa public keys (kid → PEM) của Firebase securetoken */
const FIREBASE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

/** Thời gian cache cert (1 giờ) — tránh fetch Google mỗi request */
const FIREBASE_CERT_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Kiểm tra Firebase đã được cấu hình (project id hoặc đường dẫn service account).
 * Dùng để bật/tắt tính năng đăng nhập Google trên môi trường cụ thể.
 */
export function isFirebaseConfigured(): boolean {
  return !!(env.FIREBASE_PROJECT_ID || env.FIREBASE_SERVICE_ACCOUNT_PATH);
}

/** Chuyển đường dẫn service account thành absolute path từ cwd nếu cần */
function resolveServiceAccountPath(serviceAccountPath: string): string {
  return path.isAbsolute(serviceAccountPath)
    ? serviceAccountPath
    : path.resolve(process.cwd(), serviceAccountPath);
}

/** Đọc project_id từ file JSON service account (không khởi tạo Admin SDK) */
function loadServiceAccountProjectId(absolutePath: string): string | undefined {
  try {
    const raw = fs.readFileSync(absolutePath, "utf8");
    const parsed = JSON.parse(raw) as { project_id?: string };
    return parsed.project_id;
  } catch {
    return undefined;
  }
}

/** Giải mã JWT không verify — chỉ lấy header/payload để debug hoặc lấy kid */
function decodeJwt(
  token: string,
): { header: JwtHeader; payload: JwtPayload } | null {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === "string") return null;
  return {
    header: decoded.header as JwtHeader,
    payload: decoded.payload as JwtPayload,
  };
}

/**
 * Khởi tạo Firebase Admin App một lần và trả về Auth instance.
 * Yêu cầu FIREBASE_SERVICE_ACCOUNT_PATH trỏ tới file JSON hợp lệ.
 */
async function ensureFirebase(): Promise<Auth> {
  if (!env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    throw new Error("Firebase service account is not configured");
  }

  if (!initPromise) {
    initPromise = (async () => {
      if (getApps().length > 0) return;

      const serviceAccountPath = env.FIREBASE_SERVICE_ACCOUNT_PATH!;
      const absolutePath = resolveServiceAccountPath(serviceAccountPath);

      if (!fs.existsSync(absolutePath)) {
        throw new Error(
          `Firebase service account file not found: ${absolutePath}`,
        );
      }

      const serviceAccountProjectId = loadServiceAccountProjectId(absolutePath);
      const projectId = env.FIREBASE_PROJECT_ID ?? serviceAccountProjectId;

      if (!projectId) {
        throw new Error(
          "Firebase project id is missing. Set FIREBASE_PROJECT_ID or use a valid service account file.",
        );
      }

      initializeApp({
        credential: cert(absolutePath),
        projectId,
      });
    })();
  }

  await initPromise;
  return getAuth();
}

/**
 * Lấy bộ chứng chỉ công khai Firebase (có cache TTL).
 * Dùng kid trong JWT header để chọn đúng public key khi verify RS256.
 */
async function getFirebaseCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (certCache && certCache.expiresAt > now) {
    return certCache.certs;
  }

  const response = await fetch(FIREBASE_CERTS_URL, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Firebase public certs: ${response.status}`,
    );
  }

  const certs = (await response.json()) as Record<string, string>;
  certCache = {
    certs,
    expiresAt: now + FIREBASE_CERT_CACHE_TTL_MS,
  };
  return certs;
}

/**
 * Danh sách project id có thể dùng để verify audience/issuer.
 * Thử lần lượt env config và aud trong token.
 */
function getFirebaseProjectCandidates(payload: JwtPayload): string[] {
  const candidates = [
    env.FIREBASE_PROJECT_ID,
    typeof payload.aud === "string" ? payload.aud : undefined,
  ];
  return [
    ...new Set(
      candidates.filter(
        (value): value is string => !!value && value.length > 0,
      ),
    ),
  ];
}

/**
 * Verify Firebase ID token cục bộ bằng public cert + jwt.verify.
 * Nhanh hơn gọi Admin SDK; phù hợp khi chỉ cần uid/email từ token.
 */
async function verifyFirebaseIdTokenLocally(idToken: string) {
  const decoded = decodeJwt(idToken);
  if (!decoded?.header.kid) {
    throw new Error("Missing JWT key id");
  }

  const certs = await getFirebaseCerts();
  const publicKey = certs[decoded.header.kid];
  if (!publicKey) {
    throw new Error(`Unknown Firebase signing key: ${decoded.header.kid}`);
  }

  const projectCandidates = getFirebaseProjectCandidates(decoded.payload);
  let lastError: unknown;

  for (const projectId of projectCandidates) {
    try {
      const verified = jwt.verify(idToken, publicKey, {
        algorithms: ["RS256"],
        audience: projectId,
        issuer: `https://securetoken.google.com/${projectId}`,
      }) as JwtPayload;

      const uid =
        typeof verified.user_id === "string" && verified.user_id
          ? verified.user_id
          : typeof verified.sub === "string"
            ? verified.sub
            : undefined;

      if (!uid) {
        throw new Error("Firebase token missing user id");
      }

      return {
        uid,
        email: typeof verified.email === "string" ? verified.email : undefined,
        name: typeof verified.name === "string" ? verified.name : undefined,
        email_verified:
          typeof verified.email_verified === "boolean"
            ? verified.email_verified
            : typeof verified.email_verified === "string"
              ? verified.email_verified === "true"
              : undefined,
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Invalid Firebase ID token");
}

/**
 * Fallback: gọi Google OAuth2 tokeninfo API để validate id_token.
 * Trả về null nếu token không hợp lệ hoặc thiếu sub/email.
 */
async function verifyGoogleIdentityToken(idToken: string) {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    { signal: AbortSignal.timeout(10_000) },
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    email_verified?: string | boolean;
  };

  if (!payload.sub || !payload.email) {
    return null;
  }

  return {
    uid: payload.sub,
    email: payload.email,
    name: payload.name,
    email_verified:
      typeof payload.email_verified === "string"
        ? payload.email_verified === "true"
        : payload.email_verified,
  };
}

/** Ghi log claims JWT khi verify thất bại — hỗ trợ debug production */
function logTokenDebugInfo(idToken: string) {
  const decoded = decodeJwt(idToken);
  if (!decoded) {
    console.error("[auth/google] token is not a valid JWT");
    return;
  }

  const { header, payload } = decoded;
  const exp = payload.exp;
  const expAt =
    typeof exp === "number" ? new Date(exp * 1000).toISOString() : "n/a";
  console.error(
    `[auth/google] token claims: alg=${String(header.alg ?? "n/a")} kid=${String(header.kid ?? "n/a")} ` +
      `iss=${String(payload.iss ?? "n/a")} aud=${String(payload.aud ?? "n/a")} ` +
      `exp=${String(exp ?? "n/a")} (${expAt}) email=${String(payload.email ?? "n/a")}`,
  );
}

/**
 * Entry point chính: xác thực Google ID Token từ client.
 * Thử local Firebase verify → Admin SDK → Google tokeninfo; ném lỗi gộp nếu tất cả fail.
 */
export async function verifyGoogleIdToken(idToken: string) {
  let firebaseAdminError: unknown;

  try {
    const decoded = await verifyFirebaseIdTokenLocally(idToken);
    return decoded;
  } catch (err) {
    firebaseAdminError = err;
  }

  if (env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    try {
      const auth = await ensureFirebase();
      const decoded = await auth.verifyIdToken(idToken);
      return {
        uid: decoded.uid,
        email: decoded.email,
        name: decoded.name,
        email_verified: decoded.email_verified,
      };
    } catch (err) {
      firebaseAdminError = err;
    }
  }

  const googlePayload = await verifyGoogleIdentityToken(idToken).catch(
    (err: unknown) => {
      return {
        networkError: err instanceof Error ? err.message : String(err),
      } as const;
    },
  );
  if (googlePayload && "uid" in googlePayload) {
    return googlePayload;
  }

  const googleDetail =
    googlePayload && "networkError" in googlePayload
      ? `tokeninfo unavailable: ${googlePayload.networkError}`
      : "tokeninfo rejected the token";
  const firebaseDetail =
    firebaseAdminError instanceof Error
      ? firebaseAdminError.message
      : String(firebaseAdminError);
  logTokenDebugInfo(idToken);
  throw new Error(
    `Invalid Google ID token. Firebase: ${firebaseDetail} | Google: ${googleDetail}`,
  );
}
