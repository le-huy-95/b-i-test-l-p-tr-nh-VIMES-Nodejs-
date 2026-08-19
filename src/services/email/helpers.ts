import { env } from '../../config/env';

export function getDefaultSiteName(): string {
  return env.DEFAULT_FROM_NAME;
}

export function getDefaultSiteUrl(): string {
  return env.APP_PUBLIC_URL;
}

export function getDefaultFromAddress(): string {
  return env.DEFAULT_FROM_ADDRESS;
}

export function normalizeEmailArray(email: string | string[]): string[] {
  return Array.isArray(email) ? email : [email];
}

export function createTemplateData(data: Record<string, unknown>): Record<string, unknown> {
  return {
    ...data,
    siteName: (data.siteName as string) || getDefaultSiteName(),
    siteUrl: (data.siteUrl as string) || getDefaultSiteUrl(),
    currentYear: new Date().getFullYear(),
  };
}

export function formatEmailList(emails: string[]): string {
  return emails.join(', ');
}

const TENANT_ROLE_LABELS: Record<string, string> = {
  admin: 'Quản trị viên',
  warehouse_keeper: 'Thủ kho',
  accountant: 'Kế toán',
  staff: 'Nhân viên',
};

export function tenantRoleLabel(role: string): string {
  return TENANT_ROLE_LABELS[role] ?? role;
}
