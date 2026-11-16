import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RegisterDto } from './register.dto';

const VALID_PASSWORD = 'секрет12';

const toDto = (body: Record<string, unknown>): RegisterDto =>
  plainToInstance(RegisterDto, body);

const failedProperties = async (dto: RegisterDto): Promise<string[]> =>
  (await validate(dto)).map((error) => error.property);

// Well-formed address of an exact total length: 64-char local part, 63-char labels
const emailOfLength = (length: number): string => {
  const local = 'l'.repeat(64);
  const fixed = `${'a'.repeat(63)}.${'b'.repeat(63)}`;
  const tld = '.com';
  const filler = length - local.length - 1 - fixed.length - 1 - tld.length;
  return `${local}@${fixed}.${'c'.repeat(filler)}${tld}`;
};

describe('RegisterDto', () => {
  describe('email', () => {
    it('should trim and lowercase the email', async () => {
      const dto = toDto({
        email: '  New@Example.com ',
        password: VALID_PASSWORD,
      });

      expect(dto.email).toBe('new@example.com');
      await expect(failedProperties(dto)).resolves.toEqual([]);
    });

    it('should keep plus-addressed emails as distinct addresses', async () => {
      const dto = toDto({
        email: 'User+Tag@Example.com',
        password: VALID_PASSWORD,
      });

      expect(dto.email).toBe('user+tag@example.com');
      await expect(failedProperties(dto)).resolves.toEqual([]);
    });

    it('should accept an email of exactly 254 characters', async () => {
      const email = emailOfLength(254);
      const dto = toDto({ email, password: VALID_PASSWORD });

      expect(email).toHaveLength(254);
      await expect(failedProperties(dto)).resolves.toEqual([]);
    });

    it.each([
      ['an invalid format', { email: 'bad' }],
      ['a missing email', {}],
      ['a non-string email', { email: 42 }],
      ['an email longer than 254 characters', { email: emailOfLength(255) }],
    ])('should reject %s', async (_case, body) => {
      const dto = toDto({ ...body, password: VALID_PASSWORD });

      await expect(failedProperties(dto)).resolves.toEqual(['email']);
    });
  });

  describe('password', () => {
    it('should not trim the password', async () => {
      const dto = toDto({ email: 'a@example.com', password: '  abcdefg1 ' });

      expect(dto.password).toBe('  abcdefg1 ');
      await expect(failedProperties(dto)).resolves.toEqual([]);
    });

    it.each([
      ['a password that breaks the policy', { password: 'short1' }],
      ['a missing password', {}],
      ['a non-string password', { password: 12345678 }],
    ])('should reject %s', async (_case, body) => {
      const dto = toDto({ email: 'a@example.com', ...body });

      await expect(failedProperties(dto)).resolves.toEqual(['password']);
    });
  });
});
