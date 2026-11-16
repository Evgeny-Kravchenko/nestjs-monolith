import { PasswordHasher } from './password-hasher';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();
  const password = 'секрет12';

  it('should produce an Argon2id hash with the OWASP minimum parameters', async () => {
    const hash = await hasher.hash(password);

    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
  });

  it('should not contain the original password', async () => {
    const hash = await hasher.hash(password);

    expect(hash).not.toBe(password);
    expect(hash).not.toContain(password);
  });

  it('should salt every hash so the same password hashes differently', async () => {
    const [first, second] = await Promise.all([
      hasher.hash(password),
      hasher.hash(password),
    ]);

    expect(first).not.toBe(second);
  });

  it('should verify the original password against its hash', async () => {
    const hash = await hasher.hash(password);

    await expect(hasher.verify(hash, password)).resolves.toBe(true);
  });

  it('should reject a different password', async () => {
    const hash = await hasher.hash(password);

    await expect(hasher.verify(hash, 'секрет13')).resolves.toBe(false);
  });

  it('should keep surrounding whitespace significant', async () => {
    const hash = await hasher.hash(' abcdefg1 ');

    await expect(hasher.verify(hash, 'abcdefg1')).resolves.toBe(false);
    await expect(hasher.verify(hash, ' abcdefg1 ')).resolves.toBe(true);
  });
});
