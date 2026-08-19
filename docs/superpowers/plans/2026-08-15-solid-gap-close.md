# SOLID Gap-Close (hướng A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Auth ports + AuthMailer/InviteMailer/Google adapters + Prisma inject phiếu kho; API/hành vi không đổi; tests xanh.

**Spec:** `docs/superpowers/specs/2026-08-15-solid-gap-close-design.md`

**Note:** Không git commit trừ khi user yêu cầu.

---

## File map

| File | Action |
|------|--------|
| `src/modules/auth/otp.port.ts` | Create |
| `src/modules/auth/token.port.ts` | Create |
| `src/modules/auth/device.port.ts` | Create |
| `src/modules/auth/auth-mailer.port.ts` | Create |
| `src/modules/auth/google-auth.port.ts` | Create |
| `src/modules/tenant/invite-mailer.port.ts` | Create |
| `src/infra/email-auth-mailer.ts` | Create |
| `src/infra/email-invite-mailer.ts` | Create |
| `src/infra/firebase-google-auth.ts` | Create |
| `src/modules/auth/otp.service.ts` | Edit — implements + AuthMailer |
| `src/modules/auth/token.service.ts` | Edit — implements |
| `src/modules/auth/device.service.ts` | Edit — implements |
| `src/modules/auth/auth.service.ts` | Edit — port types + mailer + google |
| `src/modules/tenant/tenant.service.ts` | Edit — InviteMailer |
| `src/modules/stock-receipt/stock-receipt.service.ts` | Edit — PrismaClient inject |
| `src/modules/stock-issue/stock-issue.service.ts` | Edit — PrismaClient inject |
| `src/modules/stock-opening/stock-opening.service.ts` | Edit — PrismaClient inject |
| `tests/modules/auth.service.test.ts` | Edit only if mocks break |
| `tests/modules/tenant.service.test.ts` | Edit only if mocks break |

**Test strategy:** Adapters delegate to existing `services/email` and `config/firebase`. Existing `vi.mock` on those paths should keep working. If not, mock adapter singletons instead.

---

### Task 1: Auth collaborator ports + implements

**Files:** create 3 ports; edit otp/token/device services (implements only — mailer in Task 2)

- [ ] **Step 1: Create `otp.port.ts`**

```ts
export interface OtpIssuer {
  issueOtp(
    userId: string,
    channel: 'email' | 'phone',
    purpose: string,
    destination: string,
    userName?: string,
  ): Promise<{ expiresAt: Date }>;
  verifyOtp(input: unknown): Promise<{ verified: true }>;
  resendOtp(input: unknown): Promise<{ expiresAt: Date }>;
}
```

Align return types exactly with current `OtpService` methods (read file if differ).

- [ ] **Step 2: Create `token.port.ts`**

```ts
export interface TokenIssuer {
  issueTokens(
    userId: string,
    tokenVersion: number,
  ): Promise<{ accessToken: string; refreshToken: string }>;
  refresh(input: unknown): Promise<{ accessToken: string; refreshToken: string }>;
  logout(input: unknown): Promise<{ success: true }>;
}
```

Align with actual `TokenService` return shapes (read `token.service.ts` logout/refresh returns).

- [ ] **Step 3: Create `device.port.ts`**

```ts
export interface DeviceRegistry {
  registerDevice(
    userId: string,
    input: unknown,
  ): Promise<{ device: unknown; isUpdate: boolean }>;
}
```

Prefer concrete device response type from `DeviceDto` if cleaner — match `DeviceService.registerDevice` return.

- [ ] **Step 4: Add `implements` on services**

```ts
export class OtpService implements OtpIssuer { ... }
export class TokenService implements TokenIssuer { ... }
export class DeviceService implements DeviceRegistry { ... }
```

Do **not** change AuthService constructors yet (Task 3). Do **not** inject mailer yet (Task 2).

- [ ] **Step 5:** `npx tsc --noEmit` — exit 0. Skip commit.

---

### Task 2: AuthMailer + InviteMailer + Google adapters

- [ ] **Step 1: Create `auth-mailer.port.ts`**

```ts
import type { EmailResult } from '../../services/email/types';

export interface AuthMailer {
  sendOtp(data: {
    to: string;
    userName?: string;
    otpCode: string;
    expiryMinutes: number;
    userId?: string;
  }): Promise<EmailResult>;
  sendWelcome(data: {
    to: string;
    userName?: string;
    userId?: string;
  }): Promise<EmailResult>;
}
```

- [ ] **Step 2: Create `invite-mailer.port.ts`**

```ts
import type { EmailResult } from '../../services/email/types';

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

- [ ] **Step 3: Create `google-auth.port.ts`**

```ts
export interface GoogleVerifiedId {
  uid: string;
  email?: string;
  name?: string;
  email_verified?: boolean;
}

export interface GoogleTokenVerifier {
  isConfigured(): boolean;
  verifyIdToken(idToken: string): Promise<GoogleVerifiedId>;
}
```

- [ ] **Step 4: Create adapters**

`src/infra/email-auth-mailer.ts`:

```ts
import { sendOtpEmail, sendWelcomeEmail } from '../services/email';
import type { AuthMailer } from '../modules/auth/auth-mailer.port';

export class EmailAuthMailer implements AuthMailer {
  sendOtp = sendOtpEmail;
  sendWelcome = sendWelcomeEmail;
}

export const authMailer = new EmailAuthMailer();
```

(If method assignment typing fails, wrap with async methods that call the handlers.)

`src/infra/email-invite-mailer.ts`:

```ts
import { sendInviteEmail } from '../services/email';
import type { InviteMailer } from '../modules/tenant/invite-mailer.port';

export class EmailInviteMailer implements InviteMailer {
  sendInvite = sendInviteEmail;
}

export const inviteMailer = new EmailInviteMailer();
```

`src/infra/firebase-google-auth.ts`:

```ts
import { isFirebaseConfigured, verifyGoogleIdToken } from '../config/firebase';
import type { GoogleTokenVerifier, GoogleVerifiedId } from '../modules/auth/google-auth.port';

export class FirebaseGoogleAuth implements GoogleTokenVerifier {
  isConfigured() {
    return isFirebaseConfigured();
  }
  async verifyIdToken(idToken: string): Promise<GoogleVerifiedId> {
    const decoded = await verifyGoogleIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      email_verified: decoded.email_verified,
    };
  }
}

export const googleAuth = new FirebaseGoogleAuth();
```

- [ ] **Step 5: Wire OtpService**

```ts
constructor(
  private readonly db: PrismaClient = prisma,
  private readonly mailer: AuthMailer = authMailer,
) {}
// replace sendOtpEmail(...) with this.mailer.sendOtp(...)
export const otpService = new OtpService(prisma, authMailer);
```

Remove `import { sendOtpEmail } from '../../services/email'`.

- [ ] **Step 6: Wire TenantService**

```ts
constructor(
  private readonly db: PrismaClient = prisma,
  private readonly cache: PermissionCache = permissionCache,
  private readonly mailer: InviteMailer = inviteMailer,
) {}
// sendInviteEmail(...) -> this.mailer.sendInvite(...)
export const tenantService = new TenantService(prisma, permissionCache, inviteMailer);
```

Remove direct email import.

- [ ] **Step 7:** `npx tsc --noEmit`. Skip commit.

---

### Task 3: AuthService ports + mailer + google

- [ ] **Step 1: Update AuthService constructor and imports**

```ts
import type { OtpIssuer } from './otp.port';
import { otpService } from './otp.service';
import type { TokenIssuer } from './token.port';
import { tokenService } from './token.service';
import type { DeviceRegistry } from './device.port';
import { deviceService } from './device.service';
import type { AuthMailer } from './auth-mailer.port';
import { authMailer } from '../../infra/email-auth-mailer';
import type { GoogleTokenVerifier } from './google-auth.port';
import { googleAuth } from '../../infra/firebase-google-auth';

export class AuthService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly otp: OtpIssuer = otpService,
    private readonly tokens: TokenIssuer = tokenService,
    private readonly devices: DeviceRegistry = deviceService,
    private readonly mailer: AuthMailer = authMailer,
    private readonly google: GoogleTokenVerifier = googleAuth,
  ) {}
```

- [ ] **Step 2: Replace email/firebase usages**

- `sendWelcomeEmail(...)` → `this.mailer.sendWelcome(...)`
- `isFirebaseConfigured()` → `this.google.isConfigured()`
- `verifyGoogleIdToken(...)` → `this.google.verifyIdToken(...)`

Remove imports from `services/email` and `config/firebase`.

- [ ] **Step 3: Composition**

```ts
export const authService = new AuthService(
  prisma,
  otpService,
  tokenService,
  deviceService,
  authMailer,
  googleAuth,
);
```

- [ ] **Step 4: Fix auth tests if needed**

Run `npx vitest run tests/modules/auth.service.test.ts`.  
If mocks fail: keep mocking `services/email` + `config/firebase` (adapters still import them) — should pass.  
If module cache order breaks, also mock:

```ts
vi.mock('../../src/infra/email-auth-mailer', () => ({
  authMailer: {
    sendOtp: mockSendOtpEmail,
    sendWelcome: mockSendWelcomeEmail,
  },
}));
vi.mock('../../src/infra/firebase-google-auth', () => ({
  googleAuth: {
    isConfigured: mockIsFirebaseConfigured,
    verifyIdToken: mockVerifyGoogleIdToken,
  },
}));
```

Same pattern for `tenant.service.test.ts` if invite fails — mock `email-invite-mailer` or keep `services/email` mock.

- [ ] **Step 5:** `npx tsc --noEmit`. Skip commit.

---

### Task 4: Prisma inject stock receipt / issue / opening

- [ ] **Step 1: StockReceiptService**

```ts
import type { PrismaClient } from '../../infra/prisma-types';
import { prisma } from '../../infra/prisma';

export class StockReceiptService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly posting: StockPostingPort = stockPostingService,
  ) {}
  // prisma.X -> this.db.X everywhere
}
export const stockReceiptService = new StockReceiptService(prisma, stockPostingService);
```

- [ ] **Step 2: StockOpeningService** — same (`db`, `posting`).

- [ ] **Step 3: StockIssueService**

```ts
constructor(
  private readonly db: PrismaClient = prisma,
  private readonly balance: StockBalanceReader = stockBalanceService,
  private readonly posting: StockPostingPort = stockPostingService,
) {}
export const stockIssueService = new StockIssueService(
  prisma,
  stockBalanceService,
  stockPostingService,
);
```

Replace all `prisma.` with `this.db.` (including `$transaction`).

- [ ] **Step 4: Full verify**

```bash
npx vitest run tests/modules
npx tsc --noEmit
```

Expected: all module tests pass (33+), tsc exit 0.

- [ ] **Step 5: Spec grep checks**

```bash
rg "from '../../services/email'|from \"../../services/email\"" src/modules/auth src/modules/tenant
rg "from '../../config/firebase'" src/modules/auth
rg "private readonly (otp|tokens|devices): (Otp|Token|Device)Service" src/modules/auth
```

Expected: no matches (Auth/Tenant modules don't import email/firebase handlers; AuthService uses port types).

- [ ] **Step 6: Skip commit.** Report Vietnamese summary to user.

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| OtpIssuer / TokenIssuer / DeviceRegistry | 1 |
| AuthMailer / InviteMailer / Google + adapters | 2 |
| AuthService port + mailer + google | 3 |
| Tenant InviteMailer | 2 |
| Otp AuthMailer | 2 |
| Prisma phiếu kho | 4 |
| Tests / tsc | 3–4 |
| No CRUD ports | — |

## Self-review notes for implementers

- Do not change OTP/token crypto logic.
- Adapters stay thin (delegate only).
- Constructor parameter order: document in composition exports explicitly (avoid relying only on defaults for production singletons).
