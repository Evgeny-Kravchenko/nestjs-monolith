import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { IsPasswordPolicy } from './password-policy.validator';

class PasswordHolder {
  @IsPasswordPolicy()
  password: unknown;
}

const TOO_SHORT = 'password must be at least 8 characters long';
const LETTER_AND_DIGIT =
  'password must contain at least one letter and one digit';
const TOO_LONG = 'password must be at most 72 bytes long';

const errorsFor = async (password: unknown): Promise<string[]> => {
  const errors = await validate(plainToInstance(PasswordHolder, { password }));
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
};

describe('IsPasswordPolicy', () => {
  it.each([
    ['letters from any alphabet plus a digit', 'секрет12'],
    ['surrounding whitespace counts as part of the password', '  abcdefg1 '],
    ['exactly 72 bytes in UTF-8', 'ж'.repeat(35) + 'a1'],
  ])('should accept %s', async (_case, password) => {
    await expect(errorsFor(password)).resolves.toEqual([]);
  });

  it('should reject fewer than 8 characters', async () => {
    await expect(errorsFor('abcdef1')).resolves.toEqual([TOO_SHORT]);
  });

  it('should count characters, not bytes, for the minimum length', async () => {
    await expect(errorsFor('жжжжжж1')).resolves.toEqual([TOO_SHORT]);
  });

  it('should count an emoji as one character, not two UTF-16 units', async () => {
    const password = '😀😀😀😀😀a1';

    expect(password.length).toBe(12);
    await expect(errorsFor(password)).resolves.toEqual([TOO_SHORT]);
  });

  it('should reject a password without a letter', async () => {
    await expect(errorsFor('12345678')).resolves.toEqual([LETTER_AND_DIGIT]);
  });

  it('should reject a password without a digit', async () => {
    await expect(errorsFor('abcdefgh')).resolves.toEqual([LETTER_AND_DIGIT]);
  });

  it('should reject more than 72 bytes in UTF-8 instead of truncating', async () => {
    const password = 'ж'.repeat(36) + '1';

    expect(Buffer.byteLength(password, 'utf8')).toBe(73);
    await expect(errorsFor(password)).resolves.toEqual([TOO_LONG]);
  });

  it('should reject a non-string value', async () => {
    const errors = await errorsFor(12345678);

    expect(errors).toHaveLength(1);
  });
});
