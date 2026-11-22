import { Config } from './config.types';
import { configValidationSchema } from './config.validation';

describe('configValidationSchema', () => {
  const minimalEnv: Record<string, string> = {
    PORT: '3000',
    NODE_ENV: 'development',
    COOKIE_SECRET: 'cookie-secret',
    POSTGRES_HOST: 'localhost',
    POSTGRES_PORT: '5432',
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: 'postgres',
    POSTGRES_DB: 'app',
    REGISTRATION_SECRET_KEY: 'k'.repeat(32),
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    MAIL_FROM: 'no-reply@localhost',
  };

  const validate = (env: Record<string, string>) =>
    configValidationSchema.validate(env);

  // Joi types `value` as `any` unless the result is narrowed to the success branch
  const validValue = (env: Record<string, string>): Config => {
    const result = validate(env);
    if (result.error) {
      throw result.error;
    }
    return result.value;
  };

  const without = (key: string): Record<string, string> => {
    const env = { ...minimalEnv };
    delete env[key];
    return env;
  };

  it('should accept a minimal valid environment', () => {
    expect(validate(minimalEnv).error).toBeUndefined();
  });

  it('should apply defaults for optional registration and mail keys', () => {
    expect(validValue(minimalEnv)).toMatchObject({
      REGISTRATION_VERIFICATION_ENABLED: false,
      REGISTRATION_VERIFICATION_METHOD: 'otp',
      REGISTRATION_MAGIC_LINK_BASE_URL:
        'http://localhost:4200/register/confirm',
      REGISTRATION_THROTTLE_TTL: 60000,
      REGISTRATION_THROTTLE_LIMIT: 5,
      SMTP_SECURE: false,
    });
  });

  it('should accept empty SMTP credentials', () => {
    const { error } = validate({
      ...minimalEnv,
      SMTP_USER: '',
      SMTP_PASSWORD: '',
    });

    expect(error).toBeUndefined();
  });

  it('should accept magic_link as the verification method', () => {
    const value = validValue({
      ...minimalEnv,
      REGISTRATION_VERIFICATION_METHOD: 'magic_link',
    });

    expect(value.REGISTRATION_VERIFICATION_METHOD).toBe('magic_link');
  });

  it('should reject a secret key shorter than 32 characters', () => {
    const { error } = validate({
      ...minimalEnv,
      REGISTRATION_SECRET_KEY: 'k'.repeat(31),
    });

    expect(error?.message).toContain('REGISTRATION_SECRET_KEY');
  });

  it('should reject an unknown verification method', () => {
    const { error } = validate({
      ...minimalEnv,
      REGISTRATION_VERIFICATION_METHOD: 'sms',
    });

    expect(error?.message).toContain('REGISTRATION_VERIFICATION_METHOD');
  });

  it('should reject a magic link base URL that is not http(s)', () => {
    const { error } = validate({
      ...minimalEnv,
      REGISTRATION_MAGIC_LINK_BASE_URL: 'ftp://example.com/confirm',
    });

    expect(error?.message).toContain('REGISTRATION_MAGIC_LINK_BASE_URL');
  });

  it.each(['REGISTRATION_SECRET_KEY', 'SMTP_HOST', 'SMTP_PORT', 'MAIL_FROM'])(
    'should fail when %s is missing',
    (key: string) => {
      const { error } = validate(without(key));

      expect(error?.message).toBe(`"${key}" is required`);
    },
  );
});
