import {
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOneOptions } from 'typeorm';

import { CLOCK } from '@/core/clock/clock';
import { ConfigService } from '@/core/config/config.service';
import { MailService } from '@/core/mail/mail.service';
import { MailDeliveryError, OutgoingMail } from '@/core/mail/mail.types';
import { EmailAlreadyRegisteredError } from '@/modules/users/email-already-registered.error';
import { User } from '@/modules/users/user.entity';
import { UserStatus } from '@/modules/users/user-status.enum';
import { UsersService } from '@/modules/users/users.service';

import { FixedClock } from '../../../../test/support/fixed-clock';
import { PasswordHasher } from './password-hasher';
import { RegistrationChallenge } from './registration-challenge.entity';
import { RegistrationMethod } from './registration-method.enum';
import {
  type RegisterResult,
  RegistrationService,
} from './registration.service';
import { SecretHasher } from './secret-hasher';

// The transaction itself is covered by the e2e suite against real Postgres
jest.mock('typeorm-transactional', () => ({
  ...jest.requireActual<object>('typeorm-transactional'),
  Transactional: () => () => undefined,
}));

class FakeChallengeRepository {
  readonly rows = new Map<string, RegistrationChallenge>();

  constructor(private readonly users: Map<string, User>) {}

  create = jest.fn((data: Partial<RegistrationChallenge>) =>
    Object.assign(new RegistrationChallenge(), data),
  );

  save = jest.fn((challenge: RegistrationChallenge) => {
    this.rows.set(challenge.id, this.copy(challenge));
    return Promise.resolve(challenge);
  });

  findOne = jest.fn((options: FindOneOptions<RegistrationChallenge>) => {
    const where = Object.entries(options.where as object);
    const row = [...this.rows.values()].find((candidate) =>
      where.every(
        ([key, value]) =>
          candidate[key as keyof RegistrationChallenge] === value,
      ),
    );
    if (!row) {
      return Promise.resolve(null);
    }
    const found = this.copy(row);
    found.user = this.users.get(row.userId);
    return Promise.resolve(found);
  });

  update = jest.fn(
    (criteria: { id: string }, patch: Partial<RegistrationChallenge>) => {
      const row = this.rows.get(criteria.id);
      if (row) {
        Object.assign(row, patch);
      }
      return Promise.resolve({ affected: row ? 1 : 0 });
    },
  );

  only(): RegistrationChallenge {
    expect(this.rows.size).toBe(1);
    return [...this.rows.values()][0];
  }

  private copy(challenge: RegistrationChallenge): RegistrationChallenge {
    const columns = Object.assign(new RegistrationChallenge(), challenge);
    delete columns.user;
    return columns;
  }
}

describe('RegistrationService', () => {
  const email = 'new@example.com';
  const password = 'секрет12';
  const passwordHash = '$argon2id$v=19$m=19456,t=2,p=1$salt$hash';
  const code = '000042';
  const startedAt = new Date('2026-11-16T10:00:00.000Z');
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const digest = (attemptId: string, value: string): string =>
    `digest(${attemptId}:${value})`;
  // Not base64url on purpose: proves the token is URL-encoded in the link
  const token = 'tok+en/one=';
  const tokenDigest = (value: string): string => `token-digest(${value})`;

  let service: RegistrationService;
  let usersService: jest.Mocked<
    Pick<
      UsersService,
      'createActive' | 'createPending' | 'activate' | 'findByEmail'
    >
  >;
  let passwordHasher: jest.Mocked<Pick<PasswordHasher, 'hash'>>;
  let secretHasher: jest.Mocked<
    Pick<
      SecretHasher,
      | 'generateCode'
      | 'digestCode'
      | 'generateToken'
      | 'digestToken'
      | 'matches'
    >
  >;
  let mailService: { send: jest.Mock<Promise<void>, [OutgoingMail]> };
  let challenges: FakeChallengeRepository;
  let users: Map<string, User>;
  let clock: FixedClock;
  let config: Record<string, unknown>;
  let logSpy: jest.SpiedFunction<Logger['log']>;
  let warnSpy: jest.SpiedFunction<Logger['warn']>;

  const loggedOutput = (): string =>
    JSON.stringify([...logSpy.mock.calls, ...warnSpy.mock.calls]);

  const rejection = (promise: Promise<unknown>): Promise<unknown> =>
    promise.then(
      () => {
        throw new Error('expected a rejection');
      },
      (error: unknown) => error,
    );

  const expectHttpError = (
    error: unknown,
    status: number,
    message: string,
  ): void => {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
    expect((error as HttpException).message).toBe(message);
  };

  const makeUser = (id: string, status: UserStatus): User =>
    Object.assign(new User(), { id, email, status });

  beforeEach(async () => {
    config = { REGISTRATION_VERIFICATION_ENABLED: 'false' };
    users = new Map();
    clock = new FixedClock(startedAt);
    usersService = {
      createActive: jest.fn<Promise<User>, [string, string]>((userEmail) =>
        Promise.resolve(
          Object.assign(new User(), {
            id: 'user-id',
            email: userEmail,
            status: UserStatus.Active,
          }),
        ),
      ),
      createPending: jest.fn<Promise<User>, [string, string]>(() => {
        const user = makeUser('pending-user-id', UserStatus.Pending);
        users.set(user.id, user);
        return Promise.resolve(user);
      }),
      activate: jest.fn<Promise<void>, [string]>((userId) => {
        const user = users.get(userId);
        if (user) {
          user.status = UserStatus.Active;
        }
        return Promise.resolve();
      }),
      findByEmail: jest.fn<Promise<User | null>, [string]>(() =>
        Promise.resolve(null),
      ),
    };
    passwordHasher = { hash: jest.fn().mockResolvedValue(passwordHash) };
    secretHasher = {
      generateCode: jest.fn(() => code),
      digestCode: jest.fn(digest),
      generateToken: jest.fn(() => token),
      digestToken: jest.fn(tokenDigest),
      matches: jest.fn(
        (expected: string, actual: string) => expected === actual,
      ),
    };
    mailService = {
      send: jest.fn<Promise<void>, [OutgoingMail]>(() => Promise.resolve()),
    };
    challenges = new FakeChallengeRepository(users);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RegistrationService,
        { provide: UsersService, useValue: usersService },
        { provide: PasswordHasher, useValue: passwordHasher },
        { provide: SecretHasher, useValue: secretHasher },
        { provide: MailService, useValue: mailService },
        { provide: CLOCK, useValue: clock },
        {
          provide: getRepositoryToken(RegistrationChallenge),
          useValue: challenges,
        },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();

    service = moduleRef.get(RegistrationService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('register, verification disabled', () => {
    it('should create an active user from the password hash, never the raw password', async () => {
      await service.register({ email, password });

      expect(passwordHasher.hash).toHaveBeenCalledWith(password);
      expect(usersService.createActive).toHaveBeenCalledWith(
        email,
        passwordHash,
      );
      expect(
        JSON.stringify(usersService.createActive.mock.calls),
      ).not.toContain(password);
    });

    it('should return the created user', async () => {
      const result = await service.register({ email, password });

      expect(result.kind).toBe('created');
      expect(result).toMatchObject({
        user: { id: 'user-id', email, status: UserStatus.Active },
      });
    });

    // Joi coerces the flag, so at runtime ConfigService returns a boolean despite its string type
    it('should treat a boolean false flag like the string "false"', async () => {
      config.REGISTRATION_VERIFICATION_ENABLED = false;

      const result = await service.register({ email, password });

      expect(result.kind).toBe('created');
    });

    it('should map a duplicate email to 409 Email is already registered', async () => {
      usersService.createActive.mockRejectedValueOnce(
        new EmailAlreadyRegisteredError(),
      );

      const error = await service
        .register({ email, password })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        'Email is already registered',
      );
    });

    it('should rethrow unexpected errors unchanged', async () => {
      const failure = new Error('connection lost');
      usersService.createActive.mockRejectedValueOnce(failure);

      await expect(service.register({ email, password })).rejects.toBe(failure);
    });

    it('should log register.success with the user id only', async () => {
      await service.register({ email, password });

      expect(logSpy).toHaveBeenCalledWith({
        event: 'register.success',
        userId: 'user-id',
        status: UserStatus.Active,
      });
      expect(loggedOutput()).not.toContain(email);
      expect(loggedOutput()).not.toContain(password);
      expect(loggedOutput()).not.toContain(passwordHash);
    });

    it('should log register.rejected with reason duplicate and no email', async () => {
      usersService.createActive.mockRejectedValueOnce(
        new EmailAlreadyRegisteredError(),
      );

      await service.register({ email, password }).catch(() => undefined);

      expect(warnSpy).toHaveBeenCalledWith({
        event: 'register.rejected',
        reason: 'duplicate',
      });
      expect(loggedOutput()).not.toContain(email);
    });
  });

  describe('register, verification enabled (otp)', () => {
    beforeEach(() => {
      config.REGISTRATION_VERIFICATION_ENABLED = 'true';
      config.REGISTRATION_VERIFICATION_METHOD = 'otp';
    });

    it('should create a pending user from the password hash', async () => {
      await service.register({ email, password });

      expect(usersService.createPending).toHaveBeenCalledWith(
        email,
        passwordHash,
      );
      expect(usersService.createActive).not.toHaveBeenCalled();
    });

    it('should return the verification result for a 202', async () => {
      const result = await service.register({ email, password });

      expect(result).toMatchObject({
        kind: 'verification',
        confirmationRequired: true,
        method: 'otp',
        attemptId: challenges.only().id,
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });
      expect(JSON.stringify(result)).not.toContain(code);
    });

    it('should save the challenge with an app-generated uuid and a 10 minute expiry', async () => {
      await service.register({ email, password });

      const challenge = challenges.only();
      expect(challenge.id).toMatch(uuid);
      expect(challenge).toMatchObject({
        userId: 'pending-user-id',
        method: RegistrationMethod.Otp,
        secretHash: digest(challenge.id, code),
        expiresAt: new Date(startedAt.getTime() + 600_000),
        attempts: 0,
        consumedAt: null,
      });
    });

    it('should email the code to the user and claim last_sent_at before the send', async () => {
      let lastSentAtDuringSend: Date | null | undefined;
      mailService.send.mockImplementationOnce(() => {
        lastSentAtDuringSend = challenges.only().lastSentAt;
        return Promise.resolve();
      });

      await service.register({ email, password });

      expect(mailService.send).toHaveBeenCalledTimes(1);
      const [mail] = mailService.send.mock.calls[0];
      expect(mail.to).toBe(email);
      expect(mail.text).toContain(code);
      expect(lastSentAtDuringSend).toEqual(startedAt);
      expect(challenges.only().lastSentAt).toEqual(startedAt);
    });

    it('should refuse a resend with 429 while the registration email is being sent', async () => {
      usersService.findByEmail.mockImplementation(() =>
        Promise.resolve(users.get('pending-user-id') ?? null),
      );
      let resendDuringSend: unknown;
      mailService.send.mockImplementationOnce(async () => {
        resendDuringSend = await rejection(service.resend({ email }));
      });

      await service.register({ email, password });

      expectHttpError(
        resendDuringSend,
        429,
        'Please wait before requesting another email',
      );
      expect(mailService.send).toHaveBeenCalledTimes(1);
    });

    it('should return 503 when the email cannot be sent, keeping the records', async () => {
      mailService.send.mockRejectedValueOnce(new MailDeliveryError());

      const error = await rejection(service.register({ email, password }));

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as HttpException).message).toBe(
        'Verification email could not be sent',
      );
      expect(usersService.createPending).toHaveBeenCalledTimes(1);
      expect(challenges.only().lastSentAt ?? null).toBeNull();
    });

    it('should log neither the email, the password, nor the code', async () => {
      await service.register({ email, password });

      expect(loggedOutput()).not.toContain(email);
      expect(loggedOutput()).not.toContain(password);
      expect(loggedOutput()).not.toContain(code);
    });
  });

  describe('confirm with code', () => {
    const attemptId = '6f1c2a9e-3b7d-4c5e-9f80-1a2b3c4d5e6f';
    const userId = 'pending-user-id';
    const wrongCode = '999999';

    const seed = (overrides: Partial<RegistrationChallenge> = {}): void => {
      users.set(userId, makeUser(userId, UserStatus.Pending));
      challenges.rows.set(
        attemptId,
        Object.assign(new RegistrationChallenge(), {
          id: attemptId,
          userId,
          method: RegistrationMethod.Otp,
          secretHash: digest(attemptId, code),
          expiresAt: new Date(startedAt.getTime() + 600_000),
          lastSentAt: startedAt,
          attempts: 0,
          consumedAt: null,
          ...overrides,
        }),
      );
    };

    const confirm = (submitted: string, id = attemptId): Promise<unknown> =>
      service.confirm({ attemptId: id, code: submitted });

    beforeEach(() => {
      config.REGISTRATION_VERIFICATION_ENABLED = 'true';
      config.REGISTRATION_VERIFICATION_METHOD = 'otp';
    });

    it('should load the attempt by id under a pessimistic write lock', async () => {
      seed();

      await confirm(code);

      expect(challenges.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: attemptId, method: RegistrationMethod.Otp },
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('should return 400 invalid for a magic-link attempt without counting the code', async () => {
      seed({ method: RegistrationMethod.MagicLink });

      const error = await rejection(confirm(code));

      expectHttpError(error, 400, 'Invalid verification code or token');
      expect(challenges.update).not.toHaveBeenCalled();
      expect(challenges.only()).toMatchObject({
        attempts: 0,
        consumedAt: null,
      });
    });

    it('should consume the attempt and activate the user on the correct code', async () => {
      seed();

      const user = await confirm(code);

      expect(challenges.only().consumedAt).toEqual(startedAt);
      expect(challenges.only().attempts).toBe(0);
      expect(usersService.activate).toHaveBeenCalledWith(userId);
      expect(user).toMatchObject({ id: userId, status: UserStatus.Active });
    });

    it('should count a wrong code and return 400 invalid', async () => {
      seed();

      const error = await rejection(confirm(wrongCode));

      expect(error).toBeInstanceOf(BadRequestException);
      expectHttpError(error, 400, 'Invalid verification code or token');
      expect(challenges.only().attempts).toBe(1);
      expect(challenges.only().consumedAt).toBeNull();
      expect(usersService.activate).not.toHaveBeenCalled();
    });

    it.each(['12345', '0000420', 'abcdef', ' 000042'])(
      'should count the malformed code %p as a wrong entry',
      async (malformed) => {
        seed();

        const error = await rejection(confirm(malformed));

        expectHttpError(error, 400, 'Invalid verification code or token');
        expect(challenges.only().attempts).toBe(1);
      },
    );

    it('should accept the correct code on the 5th entry after 4 wrong ones', async () => {
      seed();
      for (let i = 0; i < 4; i++) {
        await rejection(confirm(wrongCode));
      }

      await confirm(code);

      expect(challenges.only().attempts).toBe(4);
      expect(challenges.only().consumedAt).toEqual(startedAt);
      expect(usersService.activate).toHaveBeenCalledWith(userId);
    });

    it('should exhaust the attempt on the 5th wrong code with 400', async () => {
      seed({ attempts: 4 });

      const error = await rejection(confirm(wrongCode));

      expectHttpError(error, 400, 'Invalid verification code or token');
      expect(challenges.only().attempts).toBe(5);
      expect(challenges.only().consumedAt).toEqual(startedAt);
    });

    it('should return 429 for any later confirm on an exhausted attempt', async () => {
      seed({ attempts: 4 });
      await rejection(confirm(wrongCode));

      const error = await rejection(confirm(code));

      expectHttpError(
        error,
        429,
        'Maximum number of verification attempts reached',
      );
      expect((error as HttpException).getResponse()).toMatchObject({
        error: 'Too Many Requests',
      });
      expect(challenges.only().attempts).toBe(5);
      expect(usersService.activate).not.toHaveBeenCalled();
    });

    it.each([
      ['the correct', code],
      ['a wrong', wrongCode],
    ])(
      'should return 400 expired for %s code at expiry without counting it',
      async (_, submitted) => {
        seed({ attempts: 2 });
        clock.advance(600_000);

        const error = await rejection(confirm(submitted));

        expectHttpError(error, 400, 'Verification code or token has expired');
        expect(challenges.only().attempts).toBe(2);
        expect(challenges.only().consumedAt).toBeNull();
        expect(usersService.activate).not.toHaveBeenCalled();
      },
    );

    it('should return 400 invalid for an unknown attempt', async () => {
      seed();

      const error = await rejection(
        confirm(code, '0d9e8f7a-6b5c-4d3e-8f21-0a1b2c3d4e5f'),
      );

      expectHttpError(error, 400, 'Invalid verification code or token');
      expect(challenges.only().attempts).toBe(0);
    });

    it('should return 400 invalid for an already confirmed attempt', async () => {
      seed({ attempts: 1, consumedAt: startedAt });

      const error = await rejection(confirm(code));

      expectHttpError(error, 400, 'Invalid verification code or token');
      expect(challenges.only().attempts).toBe(1);
      expect(usersService.activate).not.toHaveBeenCalled();
    });
  });

  describe('resend', () => {
    const attemptId = '6f1c2a9e-3b7d-4c5e-9f80-1a2b3c4d5e6f';
    const userId = 'pending-user-id';
    const newCode = '123456';
    const afterCooldown = new Date(startedAt.getTime() + 60_000);

    const seed = (overrides: Partial<RegistrationChallenge> = {}): void => {
      const user = makeUser(userId, UserStatus.Pending);
      users.set(userId, user);
      usersService.findByEmail.mockResolvedValue(user);
      challenges.rows.set(
        attemptId,
        Object.assign(new RegistrationChallenge(), {
          id: attemptId,
          userId,
          method: RegistrationMethod.Otp,
          secretHash: digest(attemptId, code),
          expiresAt: new Date(startedAt.getTime() + 600_000),
          lastSentAt: startedAt,
          attempts: 0,
          consumedAt: null,
          ...overrides,
        }),
      );
    };

    const resend = (): Promise<RegisterResult> => service.resend({ email });

    beforeEach(() => {
      config.REGISTRATION_VERIFICATION_ENABLED = 'true';
      config.REGISTRATION_VERIFICATION_METHOD = 'otp';
      secretHasher.generateCode.mockReturnValue(newCode);
    });

    it('should return the same 400 for an unknown and an active email, sending nothing', async () => {
      const unknown = await rejection(resend());
      usersService.findByEmail.mockResolvedValue(
        makeUser(userId, UserStatus.Active),
      );
      const active = await rejection(resend());

      for (const error of [unknown, active]) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as HttpException).message).toBe(
          'No pending registration for this email',
        );
      }
      expect((active as HttpException).getResponse()).toEqual(
        (unknown as HttpException).getResponse(),
      );
      expect(mailService.send).not.toHaveBeenCalled();
      expect(challenges.update).not.toHaveBeenCalled();
    });

    it('should return 400 when a confirm committed while the challenge was locked', async () => {
      seed({ attempts: 1, consumedAt: startedAt });
      clock.set(afterCooldown);

      const error = await rejection(resend());

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as HttpException).message).toBe(
        'No pending registration for this email',
      );
      expect(challenges.update).not.toHaveBeenCalled();
      expect(mailService.send).not.toHaveBeenCalled();
    });

    it('should find the user by email and lock the challenge by user id', async () => {
      seed();
      clock.set(afterCooldown);

      await resend();

      expect(usersService.findByEmail).toHaveBeenCalledWith(email);
      expect(challenges.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('should return 429 while the last delivery is less than 60 s old', async () => {
      seed();
      clock.advance(59_999);

      const error = await rejection(resend());

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).message).toBe(
        'Please wait before requesting another email',
      );
      expect((error as HttpException).getResponse()).toMatchObject({
        error: 'Too Many Requests',
      });
      expect(challenges.update).not.toHaveBeenCalled();
      expect(mailService.send).not.toHaveBeenCalled();
    });

    it('should allow an immediate resend when no delivery has succeeded yet', async () => {
      seed({ lastSentAt: null });

      await resend();

      expect(mailService.send).toHaveBeenCalledTimes(1);
      expect(challenges.only().lastSentAt).toEqual(startedAt);
    });

    it('should replace the secret and reset validity and counter in one update', async () => {
      seed({ attempts: 5, consumedAt: startedAt });
      clock.set(afterCooldown);

      await resend();

      expect(challenges.update).toHaveBeenNthCalledWith(
        1,
        { id: attemptId },
        {
          secretHash: digest(attemptId, newCode),
          expiresAt: new Date(afterCooldown.getTime() + 600_000),
          attempts: 0,
          consumedAt: null,
          lastSentAt: afterCooldown,
        },
      );
      expect(challenges.only()).toMatchObject({
        secretHash: digest(attemptId, newCode),
        attempts: 0,
        consumedAt: null,
      });
    });

    it('should email the new code and claim last_sent_at before the send', async () => {
      seed();
      clock.set(afterCooldown);
      let duringSend: Partial<RegistrationChallenge> = {};
      mailService.send.mockImplementationOnce(() => {
        const { secretHash, lastSentAt } = challenges.only();
        duringSend = { secretHash, lastSentAt };
        return Promise.resolve();
      });

      await resend();

      const [mail] = mailService.send.mock.calls[0];
      expect(mail.to).toBe(email);
      expect(mail.text).toContain(newCode);
      expect(mail.text).not.toContain(code);
      expect(duringSend).toEqual({
        secretHash: digest(attemptId, newCode),
        lastSentAt: afterCooldown,
      });
      expect(challenges.only().lastSentAt).toEqual(afterCooldown);
    });

    it('should refuse a second resend with 429 while the first email is being sent', async () => {
      seed();
      clock.set(afterCooldown);
      let secondDuringSend: unknown;
      mailService.send.mockImplementationOnce(async () => {
        secondDuringSend = await rejection(resend());
      });

      await resend();

      expectHttpError(
        secondDuringSend,
        429,
        'Please wait before requesting another email',
      );
      expect(mailService.send).toHaveBeenCalledTimes(1);
      expect(challenges.only().secretHash).toBe(digest(attemptId, newCode));
    });

    it('should give the claim back when the send fails unexpectedly', async () => {
      seed();
      clock.set(afterCooldown);
      const failure = new Error('transport crashed');
      mailService.send.mockRejectedValueOnce(failure);

      await expect(resend()).rejects.toBe(failure);

      expect(challenges.only().lastSentAt).toEqual(startedAt);
    });

    it('should return the same verification result as register', async () => {
      seed();
      clock.set(afterCooldown);

      const result = await resend();

      expect(result).toEqual({
        kind: 'verification',
        confirmationRequired: true,
        method: RegistrationMethod.Otp,
        attemptId,
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });
    });

    it('should keep the method of the challenge whatever the current config says', async () => {
      config.REGISTRATION_VERIFICATION_ENABLED = 'false';
      config.REGISTRATION_VERIFICATION_METHOD = 'magic_link';
      seed();
      clock.set(afterCooldown);

      const result = await resend();

      expect(result).toMatchObject({ method: RegistrationMethod.Otp });
      expect(challenges.only().method).toBe(RegistrationMethod.Otp);
      expect(mailService.send.mock.calls[0][0].text).toContain(newCode);
    });

    it('should return 503 when the email cannot be sent, leaving last_sent_at unchanged', async () => {
      seed();
      clock.set(afterCooldown);
      mailService.send.mockRejectedValueOnce(new MailDeliveryError());

      const error = await rejection(resend());

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as HttpException).message).toBe(
        'Verification email could not be sent',
      );
      expect(challenges.only().lastSentAt).toEqual(startedAt);
    });

    it('should log verification.sent without the email or any code', async () => {
      seed();
      clock.set(afterCooldown);

      await resend();

      expect(logSpy).toHaveBeenCalledWith({
        event: 'verification.sent',
        userId,
        attemptId,
        method: RegistrationMethod.Otp,
      });
      expect(loggedOutput()).not.toContain(email);
      expect(loggedOutput()).not.toContain(code);
      expect(loggedOutput()).not.toContain(newCode);
    });
  });

  describe('magic link', () => {
    const baseUrl = 'https://app.example.test/register/confirm';
    const link = `${baseUrl}?token=tok%2Ben%2Fone%3D`;

    beforeEach(() => {
      config.REGISTRATION_VERIFICATION_ENABLED = 'true';
      config.REGISTRATION_VERIFICATION_METHOD = 'magic_link';
      config.REGISTRATION_MAGIC_LINK_BASE_URL = baseUrl;
    });

    describe('register', () => {
      it('should store the token digest with method magic_link', async () => {
        await service.register({ email, password });

        expect(challenges.only()).toMatchObject({
          userId: 'pending-user-id',
          method: RegistrationMethod.MagicLink,
          secretHash: tokenDigest(token),
          expiresAt: new Date(startedAt.getTime() + 600_000),
          attempts: 0,
          consumedAt: null,
        });
        expect(secretHasher.generateCode).not.toHaveBeenCalled();
      });

      it('should return the verification result with method magic_link and no token', async () => {
        const result = await service.register({ email, password });

        expect(result).toMatchObject({
          kind: 'verification',
          method: 'magic_link',
          attemptId: challenges.only().id,
        });
        expect(JSON.stringify(result)).not.toContain(token);
        expect(JSON.stringify(result)).not.toContain('tok');
      });

      it('should email a link to the base URL with the URL-encoded token and no attempt id', async () => {
        await service.register({ email, password });

        const [mail] = mailService.send.mock.calls[0];
        expect(mail.to).toBe(email);
        expect(mail.text).toContain(link);
        expect(mail.html).toContain(link);
        expect(mail.text).not.toContain(token);
        expect(mail.text).not.toContain(challenges.only().id);
        expect(mail.html).not.toContain(challenges.only().id);
        expect(challenges.only().lastSentAt).toEqual(startedAt);
      });

      it('should log neither the email nor the token', async () => {
        await service.register({ email, password });

        expect(loggedOutput()).not.toContain(email);
        expect(loggedOutput()).not.toContain('tok');
      });
    });

    describe('confirm with token', () => {
      const attemptId = '6f1c2a9e-3b7d-4c5e-9f80-1a2b3c4d5e6f';
      const userId = 'pending-user-id';

      const seed = (overrides: Partial<RegistrationChallenge> = {}): void => {
        const user = makeUser(userId, UserStatus.Pending);
        users.set(userId, user);
        usersService.findByEmail.mockResolvedValue(user);
        challenges.rows.set(
          attemptId,
          Object.assign(new RegistrationChallenge(), {
            id: attemptId,
            userId,
            method: RegistrationMethod.MagicLink,
            secretHash: tokenDigest(token),
            expiresAt: new Date(startedAt.getTime() + 600_000),
            lastSentAt: startedAt,
            attempts: 0,
            consumedAt: null,
            ...overrides,
          }),
        );
      };

      const confirm = (submitted: string): Promise<unknown> =>
        service.confirm({ token: submitted });

      it('should find the challenge by token digest and method under a pessimistic write lock', async () => {
        seed();

        await confirm(token);

        expect(secretHasher.digestToken).toHaveBeenCalledWith(token);
        expect(challenges.findOne).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              secretHash: tokenDigest(token),
              method: RegistrationMethod.MagicLink,
            },
            lock: { mode: 'pessimistic_write' },
          }),
        );
      });

      it('should consume the challenge and activate the user on the correct token', async () => {
        seed();

        const user = await confirm(token);

        expect(challenges.only().consumedAt).toEqual(startedAt);
        expect(challenges.only().attempts).toBe(0);
        expect(usersService.activate).toHaveBeenCalledWith(userId);
        expect(user).toMatchObject({ id: userId, status: UserStatus.Active });
      });

      it('should return 400 invalid for an already used token', async () => {
        seed();
        await confirm(token);

        const error = await rejection(confirm(token));

        expectHttpError(error, 400, 'Invalid verification code or token');
        expect(usersService.activate).toHaveBeenCalledTimes(1);
      });

      it('should reject the old token after a resend and accept the new one', async () => {
        const newToken = 'new-token';
        seed();
        clock.advance(60_000);
        secretHasher.generateToken.mockReturnValue(newToken);
        await service.resend({ email });

        const error = await rejection(confirm(token));

        expectHttpError(error, 400, 'Invalid verification code or token');
        expect(usersService.activate).not.toHaveBeenCalled();
        expect(mailService.send.mock.calls[0][0].text).toContain(
          `${baseUrl}?token=${newToken}`,
        );
        await expect(confirm(newToken)).resolves.toMatchObject({
          status: UserStatus.Active,
        });
      });

      it('should return 400 expired for the correct token at expiry', async () => {
        seed();
        clock.advance(600_000);

        const error = await rejection(confirm(token));

        expectHttpError(error, 400, 'Verification code or token has expired');
        expect(challenges.only().consumedAt).toBeNull();
        expect(usersService.activate).not.toHaveBeenCalled();
      });

      it('should return 400 invalid for an unknown token without counting it', async () => {
        seed({ attempts: 4 });

        const error = await rejection(confirm('unknown-token'));

        expectHttpError(error, 400, 'Invalid verification code or token');
        expect(challenges.update).not.toHaveBeenCalled();
        expect(challenges.only()).toMatchObject({
          attempts: 4,
          consumedAt: null,
        });
      });

      it('should not match an otp challenge whose digest equals the token digest', async () => {
        seed({ method: RegistrationMethod.Otp });

        const error = await rejection(confirm(token));

        expectHttpError(error, 400, 'Invalid verification code or token');
        expect(challenges.update).not.toHaveBeenCalled();
        expect(usersService.activate).not.toHaveBeenCalled();
      });

      it('should log no token', async () => {
        seed();
        await confirm(token);
        await rejection(confirm('unknown-token'));

        expect(loggedOutput()).not.toContain('tok');
      });
    });
  });
});
