import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from '../../src/dto/auth.dto';
import { normalizeEmail, normalizePhone } from '../../src/utils/auth-normalize';

describe('auth normalization', () => {
  it('normalizes email to lowercase and trims whitespace', () => {
    expect(normalizeEmail('  User@Example.COM  ')).toBe('user@example.com');
  });

  it('trims phone numbers', () => {
    expect(normalizePhone('  0901234567  ')).toBe('0901234567');
  });

  it('registerSchema normalizes email before validation output', () => {
    const data = registerSchema.parse({
      email: '  User@Example.com ',
      password: 'secret123',
    });

    expect(data.email).toBe('user@example.com');
  });

  it('loginSchema normalizes email before validation output', () => {
    const data = loginSchema.parse({
      email: 'User@Example.com',
      password: 'secret123',
    });

    expect(data.email).toBe('user@example.com');
  });
});
