import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Test } from '@nestjs/testing';

import { ConfigService } from '@/core/config/config.service';

import { SecretHasher } from './secret-hasher';

jest.mock('node:crypto', () => {
  const actual =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return {
    ...actual,
    randomInt: jest.fn(actual.randomInt),
    timingSafeEqual: jest.fn(actual.timingSafeEqual),
  };
});

describe('SecretHasher', () => {
  const key = 'test-registration-secret-key-of-32+-chars';
  const attemptId = '6f1c2a9e-3b7d-4c5e-9f80-1a2b3c4d5e6f';
  const otherAttemptId = '0d9e8f7a-6b5c-4d3e-8f21-0a1b2c3d4e5f';
  const hmacHex = (input: string): string =>
    createHmac('sha256', key).update(input).digest('hex');

  let hasher: SecretHasher;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SecretHasher,
        {
          provide: ConfigService,
          useValue: {
            get: (name: string) =>
              name === 'REGISTRATION_SECRET_KEY' ? key : undefined,
          },
        },
      ],
    }).compile();

    hasher = moduleRef.get(SecretHasher);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateCode', () => {
    it('should always produce exactly six digits', () => {
      for (let i = 0; i < 1000; i++) {
        expect(hasher.generateCode()).toMatch(/^\d{6}$/);
      }
    });

    it('should draw from crypto.randomInt over 0..999999', () => {
      hasher.generateCode();

      expect(randomInt).toHaveBeenCalledWith(0, 1_000_000);
    });

    it.each([
      [42, '000042'],
      [0, '000000'],
      [999_999, '999999'],
    ])('should pad %i to %s', (drawn, code) => {
      jest.mocked(randomInt).mockImplementationOnce(() => drawn);

      expect(hasher.generateCode()).toBe(code);
    });
  });

  describe('generateToken', () => {
    it('should be base64url of 32 random bytes (43 characters)', () => {
      const token = hasher.generateToken();

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    });

    it('should differ between calls', () => {
      expect(hasher.generateToken()).not.toBe(hasher.generateToken());
    });
  });

  describe('digestCode', () => {
    it('should be the HMAC-SHA256 hex of "<attemptId>:<code>" with the key', () => {
      expect(hasher.digestCode(attemptId, '000042')).toBe(
        hmacHex(`${attemptId}:000042`),
      );
    });

    it('should differ for another attempt with the same code', () => {
      expect(hasher.digestCode(attemptId, '000042')).not.toBe(
        hasher.digestCode(otherAttemptId, '000042'),
      );
    });
  });

  describe('digestToken', () => {
    it('should be the 64-hex HMAC-SHA256 of the token with the key', () => {
      const token = hasher.generateToken();
      const digest = hasher.digestToken(token);

      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(digest).toBe(hmacHex(token));
    });
  });

  describe('matches', () => {
    const expected = hmacHex('a');

    it('should return true for equal digests via timingSafeEqual', () => {
      expect(hasher.matches(expected, hmacHex('a'))).toBe(true);
      expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    });

    it('should return false for a different digest of the same length', () => {
      expect(hasher.matches(expected, hmacHex('b'))).toBe(false);
      expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    });

    it('should return false for different-length input without throwing', () => {
      expect(hasher.matches(expected, expected.slice(0, 63))).toBe(false);
      expect(hasher.matches(expected, '')).toBe(false);
      expect(timingSafeEqual).not.toHaveBeenCalled();
    });
  });
});
