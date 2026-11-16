import { DataSource } from 'typeorm';

import { UsersService } from '@/modules/users/users.service';

import {
  createTestApp,
  expectNoSecretsLogged,
  TestApp,
  uniqueEmail,
} from './support/create-test-app';

const VALID_PASSWORD = 'секрет12';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
}

describe('Registration (e2e)', () => {
  describe('verification disabled', () => {
    let testApp: TestApp;
    const usedEmails: string[] = [];
    const usedPasswords: string[] = [VALID_PASSWORD];

    const register = (body: Record<string, unknown>) =>
      testApp.app.inject({ method: 'POST', url: '/auth/register', body });

    const newEmail = (prefix: string): string => {
      const email = uniqueEmail(prefix);
      usedEmails.push(email);
      return email;
    };

    const messages = (body: ErrorBody): string[] =>
      Array.isArray(body.message) ? body.message : [body.message];

    beforeAll(async () => {
      testApp = await createTestApp({
        env: {
          REGISTRATION_VERIFICATION_ENABLED: 'false',
          REGISTRATION_THROTTLE_LIMIT: '1000',
          THROTTLE_GLOBAL_LIMIT: '1000',
        },
      });
    });

    afterAll(async () => {
      if (!testApp) {
        return;
      }
      expectNoSecretsLogged(testApp.logger, [...usedEmails, ...usedPasswords]);
      await testApp.close();
    });

    it('should create an active account with a normalized email (201)', async () => {
      const email = newEmail('direct-create');
      const startedAt = Date.now();

      const response = await register({
        email: `  ${email.toUpperCase()} `,
        password: VALID_PASSWORD,
      });

      expect(Date.now() - startedAt).toBeLessThan(2000);
      expect(response.statusCode).toBe(201);
      const body = response.json<Record<string, unknown>>();
      expect(Object.keys(body).sort()).toEqual(['email', 'id', 'status']);
      expect(body).toMatchObject({ email, status: 'active' });
      expect(typeof body.id).toBe('string');
    });

    it('should store only an Argon2id hash of the password', async () => {
      const email = newEmail('direct-hash');
      await register({ email, password: VALID_PASSWORD });

      const rows: { password_hash: string }[] = await testApp.app
        .get(DataSource)
        .query('SELECT password_hash FROM users WHERE email = $1', [email]);

      expect(rows).toHaveLength(1);
      expect(rows[0].password_hash.startsWith('$argon2id$')).toBe(true);
      expect(rows[0].password_hash).not.toContain(VALID_PASSWORD);
    });

    it('should reject the same email in another letter case (409)', async () => {
      const email = newEmail('direct-dup');
      await register({ email, password: VALID_PASSWORD });

      const response = await register({
        email: email.toUpperCase(),
        password: VALID_PASSWORD,
      });

      expect(response.statusCode).toBe(409);
    });

    it('should reject an email reserved by a pending account (409)', async () => {
      const email = newEmail('direct-pending');
      await testApp.app
        .get(UsersService)
        .createPending(email, '$argon2id$v=19$m=19456,t=2,p=1$placeholder');

      const response = await register({ email, password: VALID_PASSWORD });

      expect(response.statusCode).toBe(409);
    });

    it('should treat plus-addressed emails as distinct accounts', async () => {
      const base = newEmail('direct-plus');
      const tagged = base.replace('@', '+tag@');
      usedEmails.push(tagged);

      expect(
        (await register({ email: base, password: VALID_PASSWORD })).statusCode,
      ).toBe(201);
      expect(
        (await register({ email: tagged, password: VALID_PASSWORD }))
          .statusCode,
      ).toBe(201);
    });

    it('should reject an invalid email and name the field (400)', async () => {
      const response = await register({
        email: 'bad',
        password: VALID_PASSWORD,
      });

      expect(response.statusCode).toBe(400);
      expect(
        messages(response.json<ErrorBody>()).some((m) => m.includes('email')),
      ).toBe(true);
    });

    it.each([
      ['too short', 'abcde1'],
      ['without a letter', '12345678'],
      ['without a digit', 'abcdefgh'],
      ['longer than 72 bytes', 'ж'.repeat(36) + '1'],
    ])('should reject a password %s (400)', async (_case, password) => {
      usedPasswords.push(password);

      const response = await register({
        email: newEmail('direct-policy'),
        password,
      });

      expect(response.statusCode).toBe(400);
      expect(
        messages(response.json<ErrorBody>()).some((m) =>
          m.includes('password'),
        ),
      ).toBe(true);
    });

    it('should strip unknown body fields', async () => {
      const response = await register({
        email: newEmail('direct-extra'),
        password: VALID_PASSWORD,
        status: 'pending',
        role: 'admin',
      });

      expect(response.statusCode).toBe(201);
      expect(response.json<Record<string, unknown>>()).toMatchObject({
        status: 'active',
      });
      expect(response.json<Record<string, unknown>>()).not.toHaveProperty(
        'role',
      );
    });

    it('should create exactly one account for 10 concurrent registrations of one email', async () => {
      const email = newEmail('direct-race');

      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          register({ email, password: VALID_PASSWORD }),
        ),
      );
      const statuses = responses.map((r) => r.statusCode).sort();

      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(9);

      const rows: unknown[] = await testApp.app
        .get(DataSource)
        .query('SELECT id FROM users WHERE email = $1', [email]);
      expect(rows).toHaveLength(1);
    });
  });

  describe('verification by code (otp)', () => {
    const INVALID = 'Invalid verification code or token';
    const EXPIRED = 'Verification code or token has expired';
    const EXHAUSTED = 'Maximum number of verification attempts reached';
    const UUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    let testApp: TestApp;
    const usedEmails: string[] = [];
    const usedCodes: string[] = [];

    interface PendingRegistration {
      email: string;
      attemptId: string;
      code: string;
    }

    const register = (body: Record<string, unknown>) =>
      testApp.app.inject({ method: 'POST', url: '/auth/register', body });

    const confirm = (body: Record<string, unknown>) =>
      testApp.app.inject({
        method: 'POST',
        url: '/auth/register/confirm',
        body,
      });

    const newEmail = (prefix: string): string => {
      const email = uniqueEmail(prefix);
      usedEmails.push(email);
      return email;
    };

    const codeSentTo = (email: string): string => {
      const match = testApp.mail.lastTo(email)?.text.match(/\b\d{6}\b/);
      if (!match) {
        throw new Error('no code was emailed');
      }
      usedCodes.push(match[0]);
      return match[0];
    };

    const registerPending = async (
      prefix: string,
    ): Promise<PendingRegistration> => {
      const email = newEmail(prefix);
      const response = await register({ email, password: VALID_PASSWORD });
      expect(response.statusCode).toBe(202);
      const { attemptId } = response.json<{ attemptId: string }>();
      return { email, attemptId, code: codeSentTo(email) };
    };

    // A six-digit code guaranteed to differ from the real one
    const wrongCodeFor = (code: string): string =>
      String((Number(code) + 1) % 1_000_000).padStart(6, '0');

    const attemptsInDb = async (attemptId: string): Promise<number> => {
      const rows: { attempts: number }[] = await testApp.app
        .get(DataSource)
        .query('SELECT attempts FROM registration_challenges WHERE id = $1', [
          attemptId,
        ]);
      return rows[0].attempts;
    };

    const expectError = (
      response: Awaited<ReturnType<typeof confirm>>,
      statusCode: number,
      message: string,
    ): void => {
      expect(response.statusCode).toBe(statusCode);
      expect(response.json<ErrorBody>().message).toBe(message);
    };

    beforeAll(async () => {
      testApp = await createTestApp({
        env: {
          REGISTRATION_VERIFICATION_ENABLED: 'true',
          REGISTRATION_VERIFICATION_METHOD: 'otp',
          REGISTRATION_THROTTLE_LIMIT: '1000',
          THROTTLE_GLOBAL_LIMIT: '1000',
        },
      });
    });

    afterAll(async () => {
      if (!testApp) {
        return;
      }
      expectNoSecretsLogged(testApp.logger, [
        ...usedEmails,
        VALID_PASSWORD,
        ...usedCodes,
      ]);
      await testApp.close();
    });

    it('should answer 202 with exactly the contract fields and email the code', async () => {
      const email = newEmail('otp-202');
      const startedAt = Date.now();

      const response = await register({ email, password: VALID_PASSWORD });

      expect(Date.now() - startedAt).toBeLessThan(2000);
      expect(response.statusCode).toBe(202);
      const body = response.json<Record<string, unknown>>();
      expect(Object.keys(body).sort()).toEqual([
        'attemptId',
        'confirmationRequired',
        'expiresInSeconds',
        'method',
        'resendAfterSeconds',
      ]);
      expect(body).toMatchObject({
        confirmationRequired: true,
        method: 'otp',
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });
      expect(body.attemptId).toMatch(UUID);
      const code = codeSentTo(email);
      expect(response.payload).not.toContain(code);
    });

    it('should activate the account with the correct code (200) and refuse a repeat (400)', async () => {
      const { email, attemptId, code } = await registerPending('otp-ok');
      const startedAt = Date.now();

      const response = await confirm({ attemptId, code });

      expect(Date.now() - startedAt).toBeLessThan(2000);
      expect(response.statusCode).toBe(200);
      const body = response.json<Record<string, unknown>>();
      expect(Object.keys(body).sort()).toEqual(['email', 'id', 'status']);
      expect(body).toMatchObject({ email, status: 'active' });

      expectError(await confirm({ attemptId, code }), 400, INVALID);
    });

    it('should reject a wrong code (400)', async () => {
      const { attemptId, code } = await registerPending('otp-wrong');

      expectError(
        await confirm({ attemptId, code: wrongCodeFor(code) }),
        400,
        INVALID,
      );
      expect(await attemptsInDb(attemptId)).toBe(1);
    });

    it('should accept the correct code after 4 wrong ones (200)', async () => {
      const { attemptId, code } = await registerPending('otp-fifth');
      for (let i = 0; i < 4; i++) {
        expectError(
          await confirm({ attemptId, code: wrongCodeFor(code) }),
          400,
          INVALID,
        );
      }

      expect((await confirm({ attemptId, code })).statusCode).toBe(200);
    });

    it('should lock the attempt after 5 wrong codes (429 for the correct one)', async () => {
      const { attemptId, code } = await registerPending('otp-locked');
      for (let i = 0; i < 5; i++) {
        expectError(
          await confirm({ attemptId, code: wrongCodeFor(code) }),
          400,
          INVALID,
        );
      }

      const locked = await confirm({ attemptId, code });
      expectError(locked, 429, EXHAUSTED);
      expect(locked.json()).toEqual({
        statusCode: 429,
        error: 'Too Many Requests',
        message: EXHAUSTED,
      });
      expect(await attemptsInDb(attemptId)).toBe(5);
    });

    it('should reject an expired code (400) without counting it', async () => {
      const { attemptId, code } = await registerPending('otp-expired');
      await confirm({ attemptId, code: wrongCodeFor(code) });
      testApp.clock.advance(600_000);

      expectError(await confirm({ attemptId, code }), 400, EXPIRED);
      expect(await attemptsInDb(attemptId)).toBe(1);
    });

    it('should reject an unknown attempt (400)', async () => {
      expectError(
        await confirm({
          attemptId: '0d9e8f7a-6b5c-4d3e-8f21-0a1b2c3d4e5f',
          code: '000000',
        }),
        400,
        INVALID,
      );
    });

    it.each([
      [
        'both a code and a token',
        {
          attemptId: '0d9e8f7a-6b5c-4d3e-8f21-0a1b2c3d4e5f',
          code: '000000',
          token: 'a'.repeat(43),
        },
      ],
      ['neither a code nor a token', {}],
    ])('should reject a body with %s (400)', async (_case, body) => {
      const response = await confirm(body);

      expect(response.statusCode).toBe(400);
    });

    it('should answer 503 when the email fails, keep the records, and then 409 a re-register', async () => {
      const email = newEmail('otp-503');
      testApp.mail.failNext();

      expectError(
        await register({ email, password: VALID_PASSWORD }),
        503,
        'Verification email could not be sent',
      );

      const rows: { status: string; last_sent_at: Date | null }[] =
        await testApp.app.get(DataSource).query(
          `SELECT u.status, c.last_sent_at
             FROM users u JOIN registration_challenges c ON c.user_id = u.id
            WHERE u.email = $1`,
          [email],
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ status: 'pending', last_sent_at: null });

      expect(
        (await register({ email, password: VALID_PASSWORD })).statusCode,
      ).toBe(409);
    });

    it('should let exactly one of two concurrent correct confirms win', async () => {
      const { attemptId, code } = await registerPending('otp-race-ok');

      const statuses = (
        await Promise.all([
          confirm({ attemptId, code }),
          confirm({ attemptId, code }),
        ])
      )
        .map((r) => r.statusCode)
        .sort();

      expect(statuses).toEqual([200, 400]);
    });

    it('should never count more than 5 wrong entries under concurrency', async () => {
      const { attemptId, code } = await registerPending('otp-race-wrong');
      const wrong = wrongCodeFor(code);
      for (let i = 0; i < 4; i++) {
        await confirm({ attemptId, code: wrong });
      }

      const statuses = (
        await Promise.all(
          Array.from({ length: 5 }, () => confirm({ attemptId, code: wrong })),
        )
      )
        .map((r) => r.statusCode)
        .sort();

      expect(statuses).toEqual([400, 429, 429, 429, 429]);
      expect(await attemptsInDb(attemptId)).toBe(5);
    });
  });

  describe('resend verification email', () => {
    const NO_PENDING = 'No pending registration for this email';
    const TOO_SOON = 'Please wait before requesting another email';
    const INVALID = 'Invalid verification code or token';

    let testApp: TestApp;
    const usedEmails: string[] = [];
    const usedCodes: string[] = [];

    interface PendingRegistration {
      email: string;
      attemptId: string;
      code: string;
    }

    type Inject = (
      body: Record<string, unknown>,
    ) => ReturnType<TestApp['app']['inject']>;

    const post =
      (url: string, app: () => TestApp = () => testApp): Inject =>
      (body) =>
        app().app.inject({ method: 'POST', url, body });

    const register = post('/auth/register');
    const confirm = post('/auth/register/confirm');
    const resend = post('/auth/register/resend');

    const newEmail = (prefix: string): string => {
      const email = uniqueEmail(prefix);
      usedEmails.push(email);
      return email;
    };

    const codeSentTo = (email: string, target: TestApp = testApp): string => {
      const match = target.mail.lastTo(email)?.text.match(/\b\d{6}\b/);
      if (!match) {
        throw new Error('no code was emailed');
      }
      usedCodes.push(match[0]);
      return match[0];
    };

    const registerPending = async (
      prefix: string,
    ): Promise<PendingRegistration> => {
      const email = newEmail(prefix);
      const response = await register({ email, password: VALID_PASSWORD });
      expect(response.statusCode).toBe(202);
      const { attemptId } = response.json<{ attemptId: string }>();
      return { email, attemptId, code: codeSentTo(email) };
    };

    const wrongCodeFor = (code: string): string =>
      String((Number(code) + 1) % 1_000_000).padStart(6, '0');

    const challengeRow = async (
      email: string,
    ): Promise<{ status: string; last_sent_at: Date | null }> => {
      const rows: { status: string; last_sent_at: Date | null }[] =
        await testApp.app.get(DataSource).query(
          `SELECT u.status, c.last_sent_at
             FROM users u JOIN registration_challenges c ON c.user_id = u.id
            WHERE u.email = $1`,
          [email],
        );
      expect(rows).toHaveLength(1);
      return rows[0];
    };

    const expectError = (
      response: Awaited<ReturnType<Inject>>,
      statusCode: number,
      message: string,
    ): void => {
      expect(response.statusCode).toBe(statusCode);
      expect(response.json<ErrorBody>().message).toBe(message);
    };

    const messages = (body: ErrorBody): string[] =>
      Array.isArray(body.message) ? body.message : [body.message];

    // Well-formed address of an exact total length: 64-char local part, 63-char labels
    const emailOfLength = (length: number): string => {
      const local = 'l'.repeat(64);
      const fixed = `${'a'.repeat(63)}.${'b'.repeat(63)}`;
      const tld = '.com';
      const filler = length - local.length - 1 - fixed.length - 1 - tld.length;
      return `${local}@${fixed}.${'c'.repeat(filler)}${tld}`;
    };

    beforeAll(async () => {
      testApp = await createTestApp({
        env: {
          REGISTRATION_VERIFICATION_ENABLED: 'true',
          REGISTRATION_VERIFICATION_METHOD: 'otp',
          REGISTRATION_THROTTLE_LIMIT: '1000',
          THROTTLE_GLOBAL_LIMIT: '1000',
        },
      });
    });

    afterAll(async () => {
      if (!testApp) {
        return;
      }
      expectNoSecretsLogged(testApp.logger, [
        ...usedEmails,
        VALID_PASSWORD,
        ...usedCodes,
      ]);
      await testApp.close();
    });

    it('should refuse an immediate resend (429)', async () => {
      const { email } = await registerPending('resend-early');

      const response = await resend({ email });

      expectError(response, 429, TOO_SOON);
      expect(response.json()).toEqual({
        statusCode: 429,
        error: 'Too Many Requests',
        message: TOO_SOON,
      });
    });

    it('should send exactly one email for concurrent resends after the cooldown', async () => {
      const { email } = await registerPending('resend-race');
      testApp.clock.advance(60_000);
      const mailsTo = (): number =>
        testApp.mail.sent.filter((mail) => mail.to === email).length;
      const sentBefore = mailsTo();

      const statuses = (
        await Promise.all(Array.from({ length: 3 }, () => resend({ email })))
      )
        .map((r) => r.statusCode)
        .sort();

      expect(statuses).toEqual([202, 429, 429]);
      expect(mailsTo()).toBe(sentBefore + 1);
      codeSentTo(email);
    });

    it('should send a new code after 60 s (202) and retire the old one', async () => {
      const { email, attemptId, code } = await registerPending('resend-new');
      testApp.clock.advance(60_000);

      const response = await resend({ email });

      expect(response.statusCode).toBe(202);
      const body = response.json<Record<string, unknown>>();
      expect(Object.keys(body).sort()).toEqual([
        'attemptId',
        'confirmationRequired',
        'expiresInSeconds',
        'method',
        'resendAfterSeconds',
      ]);
      expect(body).toEqual({
        attemptId,
        confirmationRequired: true,
        method: 'otp',
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });
      const newCode = codeSentTo(email);
      expect(response.payload).not.toContain(newCode);

      expectError(await confirm({ attemptId, code }), 400, INVALID);
      expect((await confirm({ attemptId, code: newCode })).statusCode).toBe(
        200,
      );
    });

    it('should unlock an exhausted attempt with a new code after the cooldown', async () => {
      const { email, attemptId, code } =
        await registerPending('resend-exhausted');
      for (let i = 0; i < 5; i++) {
        await confirm({ attemptId, code: wrongCodeFor(code) });
      }
      testApp.clock.advance(60_000);

      expect((await resend({ email })).statusCode).toBe(202);

      expect(
        (await confirm({ attemptId, code: codeSentTo(email) })).statusCode,
      ).toBe(200);
    });

    it('should answer byte-identical 400s for an unknown and an active email, sending nothing', async () => {
      const active = await registerPending('resend-active');
      expect(
        (await confirm({ attemptId: active.attemptId, code: active.code }))
          .statusCode,
      ).toBe(200);
      testApp.clock.advance(60_000);
      const sentBefore = testApp.mail.sent.length;

      const unknownResponse = await resend({
        email: newEmail('resend-unknown'),
      });
      const activeResponse = await resend({ email: active.email });

      expectError(unknownResponse, 400, NO_PENDING);
      expect(activeResponse.statusCode).toBe(400);
      expect(activeResponse.payload).toBe(unknownResponse.payload);
      expect(testApp.mail.sent).toHaveLength(sentBefore);
    });

    it('should recover from a failed registration email with an immediate resend (202)', async () => {
      const email = newEmail('resend-after-503');
      testApp.mail.failNext();
      expect(
        (await register({ email, password: VALID_PASSWORD })).statusCode,
      ).toBe(503);

      const response = await resend({ email });

      expect(response.statusCode).toBe(202);
      const { attemptId } = response.json<{ attemptId: string }>();
      expect(
        (await confirm({ attemptId, code: codeSentTo(email) })).statusCode,
      ).toBe(200);
    });

    it('should keep last_sent_at when a resend email fails (503), then allow an immediate retry (202)', async () => {
      const { email } = await registerPending('resend-503');
      const { last_sent_at: deliveredAt } = await challengeRow(email);
      testApp.clock.advance(60_000);
      testApp.mail.failNext();

      expectError(
        await resend({ email }),
        503,
        'Verification email could not be sent',
      );
      expect(await challengeRow(email)).toEqual({
        status: 'pending',
        last_sent_at: deliveredAt,
      });

      expect((await resend({ email })).statusCode).toBe(202);
    });

    it.each([
      ['an invalid email', { email: 'bad' }],
      ['a missing email', {}],
      ['an email longer than 254 characters', { email: emailOfLength(255) }],
    ])('should reject %s and name the field (400)', async (_case, body) => {
      const response = await resend(body);

      expect(response.statusCode).toBe(400);
      expect(
        messages(response.json<ErrorBody>()).some((m) => m.includes('email')),
      ).toBe(true);
    });

    it('should find the account by the normalized email', async () => {
      const { email } = await registerPending('resend-normalized');
      testApp.clock.advance(60_000);
      const mailsTo = (): number =>
        testApp.mail.sent.filter((mail) => mail.to === email).length;
      const sentBefore = mailsTo();

      const response = await resend({ email: `  ${email.toUpperCase()} ` });

      expect(response.statusCode).toBe(202);
      expect(mailsTo()).toBe(sentBefore + 1);
      codeSentTo(email);
    });

    describe('after verification is switched off', () => {
      let disabledApp: TestApp;

      const resendWhenDisabled = post(
        '/auth/register/resend',
        () => disabledApp,
      );
      const confirmWhenDisabled = post(
        '/auth/register/confirm',
        () => disabledApp,
      );

      beforeAll(async () => {
        disabledApp = await createTestApp({
          env: {
            REGISTRATION_VERIFICATION_ENABLED: 'false',
            REGISTRATION_THROTTLE_LIMIT: '1000',
            THROTTLE_GLOBAL_LIMIT: '1000',
          },
        });
      });

      afterAll(async () => {
        if (!disabledApp) {
          return;
        }
        expectNoSecretsLogged(disabledApp.logger, [
          ...usedEmails,
          VALID_PASSWORD,
          ...usedCodes,
        ]);
        await disabledApp.close();
      });

      it('should still resend and confirm a pending account, never activating it on its own', async () => {
        // A failed first delivery leaves no cooldown, so the two apps' clocks do not matter
        const email = newEmail('resend-disabled');
        testApp.mail.failNext();
        expect(
          (await register({ email, password: VALID_PASSWORD })).statusCode,
        ).toBe(503);

        const response = await resendWhenDisabled({ email });

        expect(response.statusCode).toBe(202);
        expect(response.json<Record<string, unknown>>()).toMatchObject({
          confirmationRequired: true,
          method: 'otp',
        });
        expect((await challengeRow(email)).status).toBe('pending');

        const { attemptId } = response.json<{ attemptId: string }>();
        const confirmed = await confirmWhenDisabled({
          attemptId,
          code: codeSentTo(email, disabledApp),
        });
        expect(confirmed.statusCode).toBe(200);
        expect(confirmed.json<Record<string, unknown>>()).toMatchObject({
          email,
          status: 'active',
        });
      });
    });
  });

  describe('verification by magic link', () => {
    const BASE_URL = 'https://app.example.test/register/confirm';
    const INVALID = 'Invalid verification code or token';
    const EXPIRED = 'Verification code or token has expired';

    let testApp: TestApp;
    const usedEmails: string[] = [];
    const usedTokens: string[] = [];

    type Inject = (
      body: Record<string, unknown>,
    ) => ReturnType<TestApp['app']['inject']>;

    const post =
      (url: string): Inject =>
      (body) =>
        testApp.app.inject({ method: 'POST', url, body });

    const register = post('/auth/register');
    const confirm = post('/auth/register/confirm');
    const resend = post('/auth/register/resend');

    const newEmail = (prefix: string): string => {
      const email = uniqueEmail(prefix);
      usedEmails.push(email);
      return email;
    };

    const linkSentTo = (email: string): URL => {
      const match = testApp.mail.lastTo(email)?.text.match(/https?:\/\/\S+/);
      if (!match) {
        throw new Error('no link was emailed');
      }
      return new URL(match[0]);
    };

    const tokenSentTo = (email: string): string => {
      const token = linkSentTo(email).searchParams.get('token');
      if (!token) {
        throw new Error('the emailed link has no token');
      }
      usedTokens.push(token);
      return token;
    };

    const registerPending = async (
      prefix: string,
    ): Promise<{ email: string; token: string }> => {
      const email = newEmail(prefix);
      const response = await register({ email, password: VALID_PASSWORD });
      expect(response.statusCode).toBe(202);
      return { email, token: tokenSentTo(email) };
    };

    const statusInDb = async (email: string): Promise<string> => {
      const rows: { status: string }[] = await testApp.app
        .get(DataSource)
        .query('SELECT status FROM users WHERE email = $1', [email]);
      expect(rows).toHaveLength(1);
      return rows[0].status;
    };

    const expectError = (
      response: Awaited<ReturnType<Inject>>,
      statusCode: number,
      message: string,
    ): void => {
      expect(response.statusCode).toBe(statusCode);
      expect(response.json<ErrorBody>().message).toBe(message);
    };

    beforeAll(async () => {
      testApp = await createTestApp({
        env: {
          REGISTRATION_VERIFICATION_ENABLED: 'true',
          REGISTRATION_VERIFICATION_METHOD: 'magic_link',
          REGISTRATION_MAGIC_LINK_BASE_URL: BASE_URL,
          REGISTRATION_THROTTLE_LIMIT: '1000',
          THROTTLE_GLOBAL_LIMIT: '1000',
        },
      });
    });

    afterAll(async () => {
      if (!testApp) {
        return;
      }
      expectNoSecretsLogged(testApp.logger, [
        ...usedEmails,
        VALID_PASSWORD,
        ...usedTokens,
      ]);
      await testApp.close();
    });

    it('should answer 202 with method magic_link and email a link without the attempt id', async () => {
      const email = newEmail('link-202');

      const response = await register({ email, password: VALID_PASSWORD });

      expect(response.statusCode).toBe(202);
      const body = response.json<Record<string, unknown>>();
      expect(Object.keys(body).sort()).toEqual([
        'attemptId',
        'confirmationRequired',
        'expiresInSeconds',
        'method',
        'resendAfterSeconds',
      ]);
      expect(body).toMatchObject({
        confirmationRequired: true,
        method: 'magic_link',
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });

      const link = linkSentTo(email);
      expect(`${link.origin}${link.pathname}`).toBe(BASE_URL);
      expect([...link.searchParams.keys()]).toEqual(['token']);
      expect(link.href).not.toContain(String(body.attemptId));
      const token = tokenSentTo(email);
      expect(response.payload).not.toContain(token);
    });

    it('should not activate on a GET to any registration path carrying the token (404)', async () => {
      const { email, token } = await registerPending('link-get');
      const query = `token=${encodeURIComponent(token)}`;

      for (const path of [
        '/auth/register',
        '/auth/register/confirm',
        '/auth/register/resend',
      ]) {
        const response = await testApp.app.inject({
          method: 'GET',
          url: `${path}?${query}`,
        });
        expect(response.statusCode).toBe(404);
      }

      expect(await statusInDb(email)).toBe('pending');
    });

    it('should activate the account with the token (200) and refuse its reuse (400)', async () => {
      const { email, token } = await registerPending('link-ok');

      const response = await confirm({ token });

      expect(response.statusCode).toBe(200);
      const body = response.json<Record<string, unknown>>();
      expect(Object.keys(body).sort()).toEqual(['email', 'id', 'status']);
      expect(body).toMatchObject({ email, status: 'active' });

      expectError(await confirm({ token }), 400, INVALID);
    });

    it('should retire the old token on resend and accept the new one', async () => {
      const { email, token } = await registerPending('link-resend');
      testApp.clock.advance(60_000);

      const response = await resend({ email });

      expect(response.statusCode).toBe(202);
      expect(response.json<Record<string, unknown>>()).toMatchObject({
        method: 'magic_link',
      });
      const newToken = tokenSentTo(email);
      expect(newToken).not.toBe(token);
      expect(response.payload).not.toContain(newToken);

      expectError(await confirm({ token }), 400, INVALID);
      expect((await confirm({ token: newToken })).statusCode).toBe(200);
    });

    it('should reject an expired token (400)', async () => {
      const { email, token } = await registerPending('link-expired');
      testApp.clock.advance(600_000);

      expectError(await confirm({ token }), 400, EXPIRED);
      expect(await statusInDb(email)).toBe('pending');
    });

    it('should reject an unknown token (400)', async () => {
      expectError(await confirm({ token: 'a'.repeat(43) }), 400, INVALID);
    });

    it('should not let codes sent against a link attempt lock the link', async () => {
      const email = newEmail('link-code');
      const response = await register({ email, password: VALID_PASSWORD });
      const { attemptId } = response.json<{ attemptId: string }>();
      const token = tokenSentTo(email);

      for (let i = 0; i < 5; i++) {
        expectError(await confirm({ attemptId, code: '000000' }), 400, INVALID);
      }

      expect((await confirm({ token })).statusCode).toBe(200);
    });
  });

  describe('registration rate limit', () => {
    let testApp: TestApp;
    const usedEmails: string[] = [];

    type Inject = (
      body: Record<string, unknown>,
    ) => ReturnType<TestApp['app']['inject']>;

    const post =
      (url: string): Inject =>
      (body) =>
        testApp.app.inject({ method: 'POST', url, body });

    const register = post('/auth/register');
    const confirm = post('/auth/register/confirm');
    const resend = post('/auth/register/resend');

    const newEmail = (prefix: string): string => {
      const email = uniqueEmail(prefix);
      usedEmails.push(email);
      return email;
    };

    // Run one after another so the throttler counts them in a known order
    const sequentially = async (
      count: number,
      send: () => ReturnType<Inject>,
    ): Promise<number[]> => {
      const statuses: number[] = [];
      for (let i = 0; i < count; i++) {
        statuses.push((await send()).statusCode);
      }
      return statuses;
    };

    // A fresh app per test: the throttler counts in memory per app instance
    beforeEach(async () => {
      testApp = await createTestApp({
        env: {
          REGISTRATION_VERIFICATION_ENABLED: 'false',
          REGISTRATION_THROTTLE_LIMIT: '5',
          REGISTRATION_THROTTLE_TTL: '60000',
          // Only the registration throttler may answer 429 here
          THROTTLE_GLOBAL_LIMIT: '1000',
        },
      });
    });

    afterEach(async () => {
      if (!testApp) {
        return;
      }
      expectNoSecretsLogged(testApp.logger, [...usedEmails, VALID_PASSWORD]);
      await testApp.close();
    });

    it('should let five registrations through and refuse the sixth (429)', async () => {
      const duplicate = newEmail('limit-dup');
      const bodies = [
        { email: newEmail('limit-1'), password: VALID_PASSWORD },
        { email: newEmail('limit-2'), password: VALID_PASSWORD },
        { email: newEmail('limit-3'), password: VALID_PASSWORD },
        { email: duplicate, password: VALID_PASSWORD },
        { email: duplicate, password: VALID_PASSWORD },
      ];

      const statuses: number[] = [];
      for (const body of bodies) {
        statuses.push((await register(body)).statusCode);
      }
      const sixth = await register({
        email: newEmail('limit-6'),
        password: VALID_PASSWORD,
      });

      expect(statuses).toEqual([201, 201, 201, 201, 409]);
      expect(sixth.statusCode).toBe(429);
      expect(sixth.json()).toEqual({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Too many requests',
      });
    });

    it('should not count confirm or resend against the registration limit', async () => {
      const unknownEmail = newEmail('limit-resend');
      await sequentially(5, () =>
        register({ email: newEmail('limit-fill'), password: VALID_PASSWORD }),
      );
      expect(
        (
          await register({
            email: newEmail('limit-over'),
            password: VALID_PASSWORD,
          })
        ).statusCode,
      ).toBe(429);

      // More requests than the registration limit allows, on each endpoint
      const confirmStatuses = await sequentially(6, () =>
        confirm({ token: 'a'.repeat(43) }),
      );
      const resendStatuses = await sequentially(6, () =>
        resend({ email: unknownEmail }),
      );

      expect(confirmStatuses).toEqual(Array(6).fill(400));
      expect(resendStatuses).toEqual(Array(6).fill(400));
    });

    it('should leave GET /health unthrottled', async () => {
      await sequentially(6, () =>
        register({ email: newEmail('limit-health'), password: VALID_PASSWORD }),
      );

      const statuses = await sequentially(12, () =>
        testApp.app.inject({ method: 'GET', url: '/health' }),
      );

      expect(statuses).not.toContain(429);
    });
  });

  describe('log safety', () => {
    // Distinctive address so the test can prove it never reaches the logs
    const CLIENT_IP = '203.0.113.7';
    const SECRET_KEYS = ['password', 'passwordHash', 'code', 'token'];

    let otpApp: TestApp;
    let linkApp: TestApp;
    const usedEmails: string[] = [];
    const secrets: string[] = [VALID_PASSWORD, CLIENT_IP];
    const payloads: string[] = [];

    type Response = Awaited<ReturnType<TestApp['app']['inject']>>;

    const post = async (
      target: TestApp,
      url: string,
      body: Record<string, unknown>,
    ): Promise<Response> => {
      const response = await target.app.inject({
        method: 'POST',
        url,
        body,
        remoteAddress: CLIENT_IP,
      });
      payloads.push(response.payload);
      return response;
    };

    const newEmail = (prefix: string): string => {
      const email = uniqueEmail(prefix);
      usedEmails.push(email);
      return email;
    };

    const register = (target: TestApp, email: string) =>
      post(target, '/auth/register', { email, password: VALID_PASSWORD });

    const lastMailText = (target: TestApp, email: string): string => {
      const text = target.mail.lastTo(email)?.text;
      if (!text) {
        throw new Error('no email was sent');
      }
      return text;
    };

    // CapturingLogger lines are `<level> <JSON array of the logger arguments>`
    const loggedObjects = (): Record<string, unknown>[] =>
      [otpApp, linkApp].flatMap((target) =>
        target.logger.lines.flatMap((line) => {
          const args = JSON.parse(
            line.slice(line.indexOf(' ') + 1),
          ) as unknown[];
          return args.filter(
            (arg): arg is Record<string, unknown> =>
              typeof arg === 'object' && arg !== null,
          );
        }),
      );

    const wasLogged = (event: string, reason?: string): boolean =>
      loggedObjects().some(
        (entry) =>
          entry.event === event &&
          (reason === undefined || entry.reason === reason),
      );

    const keysOf = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        return value.flatMap(keysOf);
      }
      if (typeof value === 'object' && value !== null) {
        return Object.entries(value).flatMap(([key, nested]) => [
          key,
          ...keysOf(nested),
        ]);
      }
      return [];
    };

    beforeAll(async () => {
      otpApp = await createTestApp({
        env: {
          REGISTRATION_VERIFICATION_ENABLED: 'true',
          REGISTRATION_VERIFICATION_METHOD: 'otp',
          REGISTRATION_THROTTLE_LIMIT: '5',
          THROTTLE_GLOBAL_LIMIT: '1000',
        },
      });
      linkApp = await createTestApp({
        env: {
          REGISTRATION_VERIFICATION_ENABLED: 'true',
          REGISTRATION_VERIFICATION_METHOD: 'magic_link',
          REGISTRATION_THROTTLE_LIMIT: '1000',
          THROTTLE_GLOBAL_LIMIT: '1000',
        },
      });

      // Code flow: register, one wrong code, the right code, a duplicate
      const otpEmail = newEmail('logs-otp');
      const { attemptId } = (await register(otpApp, otpEmail)).json<{
        attemptId: string;
      }>();
      const code = lastMailText(otpApp, otpEmail).match(/\b\d{6}\b/)?.[0] ?? '';
      const wrongCode = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
      secrets.push(code, wrongCode);
      await post(otpApp, '/auth/register/confirm', {
        attemptId,
        code: wrongCode,
      });
      await post(otpApp, '/auth/register/confirm', { attemptId, code });
      await register(otpApp, otpEmail);

      // Validation failure
      const badPassword = 'short1';
      secrets.push(badPassword);
      await post(otpApp, '/auth/register', {
        email: newEmail('logs-invalid'),
        password: badPassword,
      });

      // Throttled registration: keep registering until the limit answers 429
      for (let i = 0; i < 10; i++) {
        if (
          (await register(otpApp, newEmail('logs-throttle'))).statusCode === 429
        ) {
          break;
        }
      }

      // Magic-link flow: register, an unknown token, the emailed token
      const linkEmail = newEmail('logs-link');
      await register(linkApp, linkEmail);
      const link = lastMailText(linkApp, linkEmail).match(
        /https?:\/\/\S+/,
      )?.[0];
      const token =
        new URL(link ?? 'http://invalid').searchParams.get('token') ?? '';
      const unknownToken = 'b'.repeat(43);
      secrets.push(token, unknownToken);
      await post(linkApp, '/auth/register/confirm', { token: unknownToken });
      await post(linkApp, '/auth/register/confirm', { token });

      const rows: { password_hash: string }[] = await otpApp.app
        .get(DataSource)
        .query('SELECT password_hash FROM users WHERE email = ANY($1)', [
          usedEmails,
        ]);
      secrets.push(...rows.map((row) => row.password_hash));
    });

    afterAll(async () => {
      await otpApp?.close();
      await linkApp?.close();
    });

    it.each([
      ['register.success', ''],
      ['register.rejected', 'duplicate'],
      ['register.rejected', 'validation'],
      ['register.rejected', 'throttled'],
      ['verification.sent', ''],
      ['confirm.success', ''],
      ['confirm.rejected', ''],
    ])('should log %s %s', (event, reason) => {
      expect(wasLogged(event, reason || undefined)).toBe(true);
    });

    it('should log no email, password, code, token, password hash, or client IP', () => {
      expect(secrets.filter((s) => s.length > 0).length).toBeGreaterThan(5);
      for (const target of [otpApp, linkApp]) {
        expectNoSecretsLogged(target.logger, [...usedEmails, ...secrets]);
      }
    });

    it('should return no password, passwordHash, code, or token field in any response', () => {
      const keys = payloads
        .filter((payload) => payload.length > 0)
        .flatMap((payload) => keysOf(JSON.parse(payload)));

      expect(keys.filter((key) => SECRET_KEYS.includes(key))).toEqual([]);
    });
  });
});
