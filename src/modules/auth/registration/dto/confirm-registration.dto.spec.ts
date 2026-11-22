import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ConfirmRegistrationDto } from './confirm-registration.dto';

const ATTEMPT_ID = '6f1c2a9e-3b7d-4c5e-9f80-1a2b3c4d5e6f';
const TOKEN = 'a'.repeat(43);
const FORM_MESSAGE = 'Provide either attemptId and code, or token';

const messagesFor = async (body: Record<string, unknown>): Promise<string[]> =>
  (await validate(plainToInstance(ConfirmRegistrationDto, body))).flatMap(
    (error) => Object.values(error.constraints ?? {}),
  );

const failedProperties = async (
  body: Record<string, unknown>,
): Promise<string[]> =>
  (await validate(plainToInstance(ConfirmRegistrationDto, body))).map(
    (error) => error.property,
  );

describe('ConfirmRegistrationDto', () => {
  describe('form', () => {
    it('should accept attemptId with code', async () => {
      await expect(
        messagesFor({ attemptId: ATTEMPT_ID, code: '042817' }),
      ).resolves.toEqual([]);
    });

    it('should accept a token alone', async () => {
      await expect(messagesFor({ token: TOKEN })).resolves.toEqual([]);
    });

    it.each([
      ['neither form', {}],
      ['both forms', { attemptId: ATTEMPT_ID, code: '042817', token: TOKEN }],
      ['attemptId without code', { attemptId: ATTEMPT_ID }],
      ['code without attemptId', { code: '042817' }],
      ['token with code', { token: TOKEN, code: '042817' }],
      ['null fields only', { attemptId: null, code: null, token: null }],
    ])('should reject %s with one form message', async (_case, body) => {
      await expect(messagesFor(body)).resolves.toEqual([FORM_MESSAGE]);
    });
  });

  describe('fields', () => {
    it('should reject an attemptId that is not a uuid', async () => {
      await expect(
        failedProperties({ attemptId: 'not-a-uuid', code: '042817' }),
      ).resolves.toEqual(['attemptId']);
    });

    it.each([
      ['a number', 42817],
      ['longer than 16 characters', '1'.repeat(17)],
    ])('should reject a code that is %s', async (_case, code) => {
      await expect(
        failedProperties({ attemptId: ATTEMPT_ID, code }),
      ).resolves.toEqual(['code']);
    });

    // A non-six-digit code is a wrong entry for the service to count, not a 400 here
    it('should leave the code format to the service', async () => {
      await expect(
        messagesFor({ attemptId: ATTEMPT_ID, code: '12a' }),
      ).resolves.toEqual([]);
    });

    it.each([
      ['a number', 123],
      ['longer than 128 characters', 'a'.repeat(129)],
    ])('should reject a token that is %s', async (_case, token) => {
      await expect(failedProperties({ token })).resolves.toEqual(['token']);
    });
  });
});
