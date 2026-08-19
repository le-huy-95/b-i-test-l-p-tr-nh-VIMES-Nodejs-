# Design: SOLID gap-close (hướng A)

> Brainstorming 2026-08-15. User chọn **A** (đóng lỗ DIP/SRP vùng đã đụng, ~9/10), mailer **X** (AuthMailer + InviteMailer), gồm Invite + Firebase ports, inject Prisma phiếu kho. Không hexagonal CRUD.

## Goal

Siết SOLID pragmatic cho Auth / Tenant / Stock orchestration:

1. AuthService phụ thuộc **port** OTP / Token / Device (không type concrete class).
2. Email OTP/welcome và Invite qua **mailer ports**; Google login qua **GoogleTokenVerifier**.
3. Phiếu kho inject `PrismaClient` (concrete), giống Auth/Tenant level-1.
4. Giữ API + hành vi; test modules xanh.

## Non-goals

- Repository / port cho Product, Customer, Supplier, Warehouse, Report
- NestJS / Inversify / tsyringe
- Port hóa `crypto` / JWT helpers
- FIFO/FEFO costing thật, đổi URL/JSON
- Git commit (trừ khi user yêu cầu sau)

## Auth collaborator ports

```
src/modules/auth/
  otp.port.ts
  token.port.ts
  device.port.ts
```

### `OtpIssuer`

Methods khớp public API `OtpService` mà Auth dùng:

- `issueOtp(userId, channel, purpose, destination, userName?)`
- `verifyOtp(input: unknown)`
- `resendOtp(input: unknown)`

`OtpService implements OtpIssuer`.

### `TokenIssuer`

- `issueTokens(userId, tokenVersion)`
- `refresh(input: unknown)`
- `logout(input: unknown)`

`TokenService implements TokenIssuer`.

### `DeviceRegistry`

- `registerDevice(userId, input: unknown)`

`DeviceService implements DeviceRegistry`.  
(Không bắt buộc đưa `formatDeviceResponse` lên port trừ khi Auth gọi trực tiếp — hiện Auth chỉ `registerDevice`.)

### `AuthService` wiring

```ts
constructor(
  private readonly db: PrismaClient = prisma,
  private readonly otp: OtpIssuer = otpService,
  private readonly tokens: TokenIssuer = tokenService,
  private readonly devices: DeviceRegistry = deviceService,
  private readonly mailer: AuthMailer = authMailer,
  private readonly google: GoogleTokenVerifier = googleAuth,
) {}
```

Composition cuối file nối singleton concrete + adapters.

## Email + Google ports

### `AuthMailer` — `src/modules/auth/auth-mailer.port.ts`

```ts
export interface AuthMailer {
  sendOtp(data: {
    to: string;
    userName?: string;
    otpCode: string;
    expiryMinutes: number;
    userId?: string;
  }): Promise<EmailResult>; // hoặc Promise<void> nếu Auth không cần EmailResult

  sendWelcome(data: {
    to: string;
    userName?: string;
    userId?: string;
  }): Promise<EmailResult>;
}
```

Giữ payload khớp `sendOtpEmail` / `sendWelcomeEmail` hiện tại. Return type: dùng `EmailResult` từ `services/email/types` **hoặc** `Promise<void>` nếu caller bỏ qua result — ưu tiên khớp handler hiện tại (`Promise<EmailResult>`).

### `InviteMailer` — `src/modules/tenant/invite-mailer.port.ts`

```ts
export interface InviteMailer {
  sendInvite(data: {
    to: string;
    tenantName: string;
    role: string;
    inviteLink: string;
    expiryHours: number;
    userId?: string;
  }): Promise<EmailResult>;
}
```

### `GoogleTokenVerifier` — `src/modules/auth/google-auth.port.ts`

```ts
export interface GoogleTokenVerifier {
  isConfigured(): boolean;
  verifyIdToken(idToken: string): Promise<{
    uid: string;
    email?: string;
    name?: string;
    email_verified?: boolean;
  }>;
}
```

Shape tối thiểu mà `loginWithGoogle` cần (không bắt buộc phụ thuộc `DecodedIdToken` từ firebase-admin trong domain port — map trong adapter).

### Adapters (infra)

| File | Implements | Delegates to |
|------|------------|--------------|
| `src/infra/email-auth-mailer.ts` | `AuthMailer` | `sendOtpEmail`, `sendWelcomeEmail` |
| `src/infra/email-invite-mailer.ts` | `InviteMailer` | `sendInviteEmail` |
| `src/infra/firebase-google-auth.ts` | `GoogleTokenVerifier` | `isFirebaseConfigured`, `verifyGoogleIdToken` |

Export singleton: `authMailer`, `inviteMailer`, `googleAuth`.

### Consumer inject

| Consumer | New/changed deps |
|----------|------------------|
| `OtpService` | `AuthMailer` (+ existing `PrismaClient`) |
| `AuthService` | ports OTP/Token/Device + `AuthMailer` + `GoogleTokenVerifier` |
| `TenantService` | `InviteMailer` (+ existing `PrismaClient`, `PermissionCache`) |

`OtpService` / `AuthService` **không** `import` từ `services/email` hay `config/firebase` (chỉ adapter).

## Stock documents — Prisma inject

`StockReceiptService`, `StockIssueService`, `StockOpeningService`:

- Thêm `private readonly db: PrismaClient = prisma`
- Thay mọi `prisma.` trong class → `this.db.`
- Composition: `new StockReceiptService(prisma, stockPostingService)` (thứ tự: db trước, rồi posting; issue: db, balance, posting)

Không tạo repository port cho phiếu.

## Test plan

- Cập nhật mock nếu test import firebase/email trực tiếp từ service (auth.service.test.ts thường mock modules — giữ `vi.mock` trên `infra/firebase-google-auth` hoặc tiếp tục mock `config/firebase` **chỉ trong adapter tests**; khi Auth không import firebase nữa, mock chuyển sang `../../src/infra/firebase-google-auth` hoặc inject fake trong unit test mới).
- Minimal change path: adapters thin → nếu tests mock `config/firebase` và `services/email` at AuthService level, **update mocks to new import paths** used by adapters; AuthService tests that dynamically import auth.service will need mocks for adapters **or** mock the port modules’ singletons.
- Recommended: `vi.mock('../../src/infra/email-auth-mailer')` and `vi.mock('../../src/infra/firebase-google-auth')` mirroring previous mocks.
- `npx vitest run tests/modules` xanh; `npx tsc --noEmit` sạch.

## Success criteria

- AuthService type-deps = ports + PrismaClient + AuthMailer + GoogleTokenVerifier
- OtpService không import email handlers trực tiếp
- TenantService không import `sendInviteEmail` trực tiếp
- Phiếu kho dùng `this.db`
- Không port CRUD Product/…
- Tests + tsc pass

## Out of scope leftovers (chấp nhận ~9/10)

CRUD services vẫn `import { prisma }`. Crypto utils vẫn static imports trong Auth/Token (YAGNI).
