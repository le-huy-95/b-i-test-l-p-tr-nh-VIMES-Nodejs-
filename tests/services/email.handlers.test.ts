import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateTemplate = vi.fn();
const mockSendEmail = vi.fn();

vi.mock('../../src/infra/prisma', () => ({
  prisma: {},
}));

vi.mock('../../src/services/email/instance', () => ({
  emailService: {
    generateTemplate: mockGenerateTemplate,
    sendEmail: mockSendEmail,
  },
}));

describe('email handlers', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
    vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
    vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');
    vi.stubEnv('APP_PUBLIC_URL', 'http://localhost:3000');
    vi.stubEnv('DEFAULT_FROM_ADDRESS', 'info@example.com');
    vi.stubEnv('DEFAULT_FROM_NAME', 'Vimes');
    mockGenerateTemplate.mockReset();
    mockSendEmail.mockReset();
  });

  it('renders the invite template and sends the invite email', async () => {
    mockGenerateTemplate.mockResolvedValue('<html>invite body</html>');
    mockSendEmail.mockResolvedValue({ success: true, logId: 'log-1' });

    const { sendInviteEmail } = await import(
      '../../src/services/email/handlers/auth.handlers'
    );
    const result = await sendInviteEmail({
      to: 'invitee@example.com',
      tenantName: 'Acme Corp',
      role: 'accountant',
      inviterName: 'Jane Doe',
      acceptUrl: 'http://localhost:3000/invite/accept/inv-1',
      expiryHours: 72,
      userId: 'user-1',
    });

    expect(mockGenerateTemplate).toHaveBeenCalledWith('invite', {
      tenantName: 'Acme Corp',
      role: 'accountant',
      roleLabel: 'Người duyệt',
      inviterName: 'Jane Doe',
      acceptUrl: 'http://localhost:3000/invite/accept/inv-1',
      expiryHours: 72,
    });
    expect(mockSendEmail).toHaveBeenCalledWith(
      {
        to: 'invitee@example.com',
        subject: 'Lời mời tham gia Acme Corp',
        html: '<html>invite body</html>',
      },
      {
        emailType: 'invite',
        templateName: 'invite',
        userId: 'user-1',
      },
    );
    expect(result).toEqual({ success: true, logId: 'log-1' });
  });

  it('falls back to the raw role string when no Vietnamese label exists', async () => {
    mockGenerateTemplate.mockResolvedValue('<html>invite body</html>');
    mockSendEmail.mockResolvedValue({ success: true });

    const { sendInviteEmail } = await import(
      '../../src/services/email/handlers/auth.handlers'
    );
    await sendInviteEmail({
      to: 'invitee@example.com',
      tenantName: 'Acme Corp',
      role: 'custom_role',
      inviterName: 'Jane Doe',
      acceptUrl: 'http://localhost:3000/invite/accept/inv-1',
      expiryHours: 72,
    });

    expect(mockGenerateTemplate).toHaveBeenCalledWith(
      'invite',
      expect.objectContaining({ roleLabel: 'custom_role' }),
    );
  });

  it('sends an OTP email for verification', async () => {
    mockGenerateTemplate.mockResolvedValue('<html>otp body</html>');
    mockSendEmail.mockResolvedValue({ success: true, logId: 'log-2' });

    const { sendOtpEmail } = await import(
      '../../src/services/email/handlers/auth.handlers'
    );
    const result = await sendOtpEmail({
      to: 'user@example.com',
      otpCode: '123456',
      expiryMinutes: 15,
      userId: 'user-1',
    });

    expect(mockGenerateTemplate).toHaveBeenCalledWith('otp', {
      userName: 'user@example.com',
      otpCode: '123456',
      expiryMinutes: 15,
    });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('Mã OTP'),
      }),
      expect.objectContaining({ emailType: 'otp', templateName: 'otp', userId: 'user-1' }),
    );
    expect(result).toEqual({ success: true, logId: 'log-2' });
  });

  it('sends a password reset OTP email', async () => {
    mockGenerateTemplate.mockResolvedValue('<html>reset body</html>');
    mockSendEmail.mockResolvedValue({ success: true });

    const { sendPasswordResetOtpEmail } = await import(
      '../../src/services/email/handlers/auth.handlers'
    );
    await sendPasswordResetOtpEmail({
      to: 'user@example.com',
      userName: 'User One',
      otpCode: '654321',
      expiryMinutes: 15,
      userId: 'user-1',
    });

    expect(mockGenerateTemplate).toHaveBeenCalledWith('otp', {
      userName: 'User One',
      otpCode: '654321',
      expiryMinutes: 15,
    });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Đặt lại mật khẩu'),
      }),
      expect.objectContaining({ emailType: 'password_reset', templateName: 'otp' }),
    );
  });

  it('maps tenant roles to Vietnamese labels', async () => {
    const { tenantRoleLabel } = await import('../../src/services/email/helpers');
    expect(tenantRoleLabel('admin')).toBe('Quản trị viên');
    expect(tenantRoleLabel('warehouse_keeper')).toBe('Thủ kho');
    expect(tenantRoleLabel('accountant')).toBe('Kế toán');
    expect(tenantRoleLabel('staff')).toBe('Nhân viên');
    expect(tenantRoleLabel('unknown_role')).toBe('unknown_role');
  });
});

describe('email template rendering', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
    vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
    vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');
    vi.stubEnv('APP_PUBLIC_URL', 'http://localhost:3000');
    vi.stubEnv('DEFAULT_FROM_ADDRESS', 'info@example.com');
    vi.stubEnv('DEFAULT_FROM_NAME', 'Vimes');
  });

  it('renders invite.hbs inside the layout with all variables substituted', async () => {
    const fs = await import('fs/promises');
    const nodePath = await import('path');
    const Handlebars = await import('handlebars');

    const templateDir = nodePath.join(process.cwd(), 'src/services/email/templates');
    const layoutSource = await fs.readFile(
      nodePath.join(templateDir, 'layout.hbs'),
      'utf8',
    );
    Handlebars.registerPartial('layout', Handlebars.compile(layoutSource));

    const inviteSource = await fs.readFile(
      nodePath.join(templateDir, 'invite.hbs'),
      'utf8',
    );
    const html = Handlebars.compile(inviteSource)({
      siteName: 'Vimes',
      currentYear: 2026,
      inviterName: 'Jane Doe',
      tenantName: 'Acme Corp',
      roleLabel: 'Người duyệt',
      acceptUrl: 'http://localhost:3000/invite/accept/inv-1',
      expiryHours: 72,
    });

    expect(html).toContain('<h2');
    expect(html).toContain('Bạn nhận được lời mời tham gia tổ chức');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('Acme Corp');
    expect(html).toContain('Người duyệt');
    expect(html).toContain('http://localhost:3000/invite/accept/inv-1');
    expect(html).toContain('72 giờ');
    expect(html).toContain('Vimes');
    expect(html).toContain('© 2026 Vimes');
    expect(html).toContain('Chấp nhận lời mời');
    expect(html).toContain('Lời mời hết hạn sau');
  });

  it('renders otp.hbs inside the layout', async () => {
    const fs = await import('fs/promises');
    const nodePath = await import('path');
    const Handlebars = await import('handlebars');

    const templateDir = nodePath.join(process.cwd(), 'src/services/email/templates');
    const layoutSource = await fs.readFile(
      nodePath.join(templateDir, 'layout.hbs'),
      'utf8',
    );
    Handlebars.registerPartial('layout', Handlebars.compile(layoutSource));

    const otpSource = await fs.readFile(nodePath.join(templateDir, 'otp.hbs'), 'utf8');
    const html = Handlebars.compile(otpSource)({
      siteName: 'Vimes',
      currentYear: 2026,
      userName: 'User One',
      otpCode: '123456',
      expiryMinutes: 15,
    });

    expect(html).toContain('123456');
    expect(html).toContain('User One');
    expect(html).toContain('15 phút');
  });

  it('EmailService.generateTemplate composes template data and renders via template loader', async () => {
    const { EmailService } = await import('../../src/services/email/EmailService.class');
    const service = new EmailService({} as never);

    const html = await service.generateTemplate('invite', {
      tenantName: 'Acme Corp',
      role: 'staff',
      roleLabel: 'Người xem',
      inviterName: 'Jane Doe',
      acceptUrl: 'http://localhost:3000/invite/accept/inv-1',
      expiryHours: 72,
    });

    expect(html).toContain('Acme Corp');
    expect(html).toContain('Người xem');
    expect(html).toContain('Vimes');
    expect(html).toContain('http://localhost:3000/invite/accept/inv-1');
  });
});
