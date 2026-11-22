import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ResendRegistrationDto } from './resend-registration.dto';

const toDto = (body: Record<string, unknown>): ResendRegistrationDto =>
  plainToInstance(ResendRegistrationDto, body);

const failedProperties = async (
  dto: ResendRegistrationDto,
): Promise<string[]> => (await validate(dto)).map((error) => error.property);

// Well-formed address of an exact total length: 64-char local part, 63-char labels
const emailOfLength = (length: number): string => {
  const local = 'l'.repeat(64);
  const fixed = `${'a'.repeat(63)}.${'b'.repeat(63)}`;
  const tld = '.com';
  const filler = length - local.length - 1 - fixed.length - 1 - tld.length;
  return `${local}@${fixed}.${'c'.repeat(filler)}${tld}`;
};

describe('ResendRegistrationDto', () => {
  it('should trim and lowercase the email', async () => {
    const dto = toDto({ email: '  UPPER@Example.test ' });

    expect(dto.email).toBe('upper@example.test');
    await expect(failedProperties(dto)).resolves.toEqual([]);
  });

  it('should accept an email of exactly 254 characters', async () => {
    const email = emailOfLength(254);

    expect(email).toHaveLength(254);
    await expect(failedProperties(toDto({ email }))).resolves.toEqual([]);
  });

  it.each([
    ['an invalid format', { email: 'bad' }],
    ['a missing email', {}],
    ['a non-string email', { email: 42 }],
    ['an email longer than 254 characters', { email: emailOfLength(255) }],
  ])('should reject %s', async (_case, body) => {
    await expect(failedProperties(toDto(body))).resolves.toEqual(['email']);
  });
});
