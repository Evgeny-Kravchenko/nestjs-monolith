import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { CLOCK, type Clock } from '@/core/clock/clock';
import { ConfigService } from '@/core/config/config.service';
import { MailService } from '@/core/mail/mail.service';
import { MailDeliveryError } from '@/core/mail/mail.types';
import { EmailAlreadyRegisteredError } from '@/modules/users/email-already-registered.error';
import { User } from '@/modules/users/user.entity';
import { UserStatus } from '@/modules/users/user-status.enum';
import { UsersService } from '@/modules/users/users.service';

import { ConfirmRegistrationDto } from './dto/confirm-registration.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendRegistrationDto } from './dto/resend-registration.dto';
import { PasswordHasher } from './password-hasher';
import { RegistrationChallenge } from './registration-challenge.entity';
import { buildMagicLinkMail, buildOtpMail } from './registration-mail';
import { RegistrationMethod } from './registration-method.enum';
import { SecretHasher } from './secret-hasher';
import { TooManyRequestsException } from './too-many-requests.exception';

const EXPIRES_IN_SECONDS = 600;
const RESEND_AFTER_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const CODE_FORMAT = /^\d{6}$/;
const INVALID_SECRET = 'Invalid verification code or token';

type ConfirmOutcome = { attemptId?: string } & (
  | { kind: 'confirmed'; user: User }
  | {
      kind: 'rejected';
      reason: 'unknown' | 'consumed' | 'exhausted' | 'expired' | 'wrong_code';
    }
);

type Rejection = Extract<ConfirmOutcome, { kind: 'rejected' }>;

export type RegisterResult =
  | { kind: 'created'; user: User }
  | {
      kind: 'verification';
      confirmationRequired: true;
      method: RegistrationMethod;
      attemptId: string;
      expiresInSeconds: number;
      resendAfterSeconds: number;
    };

type VerificationResult = Extract<RegisterResult, { kind: 'verification' }>;

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger('Registration');

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordHasher: PasswordHasher,
    private readonly secretHasher: SecretHasher,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
    @InjectRepository(RegistrationChallenge)
    private readonly challenges: Repository<RegistrationChallenge>,
  ) {}

  async register(dto: RegisterDto): Promise<RegisterResult> {
    if (!this.isVerificationEnabled()) {
      const passwordHash = await this.passwordHasher.hash(dto.password);
      const user = await this.rejectingDuplicates(
        this.usersService.createActive(dto.email, passwordHash),
      );
      this.logger.log({
        event: 'register.success',
        userId: user.id,
        status: user.status,
      });
      return { kind: 'created', user };
    }

    const method = this.verificationMethod();
    const passwordHash = await this.passwordHasher.hash(dto.password);
    const { user, challenge, secret } = await this.rejectingDuplicates(
      this.createPendingRegistration(dto.email, passwordHash, method),
    );
    this.logger.log({
      event: 'register.success',
      userId: user.id,
      status: user.status,
    });

    await this.sendVerification(dto.email, challenge, secret, null);

    return this.verificationResult(challenge);
  }

  async resend(dto: ResendRegistrationDto): Promise<VerificationResult> {
    const { challenge, secret } = await this.reissueSecret(dto.email);
    // The challenge was loaded before the reissue update, so it still holds the previous send time
    await this.sendVerification(
      dto.email,
      challenge,
      secret,
      challenge.lastSentAt,
    );
    return this.verificationResult(challenge);
  }

  async confirm(dto: ConfirmRegistrationDto): Promise<User> {
    let outcome: ConfirmOutcome;
    if (dto.token !== undefined && dto.token !== null) {
      outcome = await this.confirmToken(dto.token);
    } else if (dto.attemptId) {
      outcome = {
        ...(await this.confirmCode(dto.attemptId, dto.code ?? '')),
        attemptId: dto.attemptId,
      };
    } else {
      outcome = { kind: 'rejected', reason: 'unknown' };
    }

    const known = outcome.attemptId ? { attemptId: outcome.attemptId } : {};
    if (outcome.kind === 'confirmed') {
      this.logger.log({ event: 'confirm.success', ...known });
      return outcome.user;
    }

    this.logger.warn({
      event: 'confirm.rejected',
      ...known,
      reason: outcome.reason,
    });
    switch (outcome.reason) {
      case 'exhausted':
        throw new TooManyRequestsException(
          'Maximum number of verification attempts reached',
        );
      case 'expired':
        throw new BadRequestException('Verification code or token has expired');
      default:
        throw new BadRequestException(INVALID_SECRET);
    }
  }

  // Returns instead of throwing: an exception would roll back the counted wrong entry
  @Transactional()
  private async confirmCode(
    attemptId: string,
    code: string,
  ): Promise<ConfirmOutcome> {
    // 'query' keeps the user out of the locked SELECT: Postgres refuses FOR UPDATE on an outer join
    // A code can never match a link token, so counting it would only lock the link
    const challenge = await this.challenges.findOne({
      where: { id: attemptId, method: RegistrationMethod.Otp },
      relations: { user: true },
      relationLoadStrategy: 'query',
      lock: { mode: 'pessimistic_write' },
    });

    if (!challenge || !challenge.user) {
      return { kind: 'rejected', reason: 'unknown' };
    }

    const now = this.clock.now();
    const rejection = this.rejectionFor(challenge, now);
    if (rejection) {
      return rejection;
    }

    const matches =
      CODE_FORMAT.test(code) &&
      this.secretHasher.matches(
        challenge.secretHash,
        this.secretHasher.digestCode(challenge.id, code),
      );

    if (!matches) {
      const attempts = challenge.attempts + 1;
      await this.challenges.update(
        { id: challenge.id },
        { attempts, consumedAt: attempts >= MAX_ATTEMPTS ? now : null },
      );
      return { kind: 'rejected', reason: 'wrong_code' };
    }

    return this.consume(challenge, challenge.user, now);
  }

  // A wrong token matches no row, so nothing is counted; returns like confirmCode
  @Transactional()
  private async confirmToken(token: string): Promise<ConfirmOutcome> {
    const challenge = await this.challenges.findOne({
      where: {
        secretHash: this.secretHasher.digestToken(token),
        method: RegistrationMethod.MagicLink,
      },
      relations: { user: true },
      relationLoadStrategy: 'query',
      lock: { mode: 'pessimistic_write' },
    });

    if (!challenge || !challenge.user) {
      return { kind: 'rejected', reason: 'unknown' };
    }

    const now = this.clock.now();
    const outcome =
      this.rejectionFor(challenge, now) ??
      (await this.consume(challenge, challenge.user, now));
    return { ...outcome, attemptId: challenge.id };
  }

  private rejectionFor(
    challenge: RegistrationChallenge,
    now: Date,
  ): Rejection | null {
    if (challenge.consumedAt) {
      return {
        kind: 'rejected',
        reason: challenge.attempts >= MAX_ATTEMPTS ? 'exhausted' : 'consumed',
      };
    }
    if (now >= challenge.expiresAt) {
      return { kind: 'rejected', reason: 'expired' };
    }
    return null;
  }

  private async consume(
    challenge: RegistrationChallenge,
    user: User,
    now: Date,
  ): Promise<ConfirmOutcome> {
    await this.challenges.update({ id: challenge.id }, { consumedAt: now });
    await this.usersService.activate(challenge.userId);
    user.status = UserStatus.Active;
    return { kind: 'confirmed', user };
  }

  // Commits before the email is sent: a failed delivery must keep both records
  @Transactional()
  private async createPendingRegistration(
    email: string,
    passwordHash: string,
    method: RegistrationMethod,
  ): Promise<{ user: User; challenge: RegistrationChallenge; secret: string }> {
    const user = await this.usersService.createPending(email, passwordHash);
    const id = randomUUID();
    const { secret, ...stored } = this.issueSecret(id, method);
    const challenge = await this.challenges.save(
      this.challenges.create({
        id,
        userId: user.id,
        method,
        ...stored,
        // Claimed before the send so a resend racing it sees the wait; given back if delivery fails
        lastSentAt: this.clock.now(),
        attempts: 0,
        consumedAt: null,
      }),
    );
    return { user, challenge, secret };
  }

  // Commits before the email is sent, like register: a failed delivery keeps the new secret
  @Transactional()
  private async reissueSecret(
    email: string,
  ): Promise<{ challenge: RegistrationChallenge; secret: string }> {
    const user = await this.usersService.findByEmail(email);
    const challenge =
      user?.status === UserStatus.Pending
        ? await this.challenges.findOne({
            where: { userId: user.id },
            lock: { mode: 'pessimistic_write' },
          })
        : null;

    // A confirm that committed while we waited for the lock leaves a consumed, not exhausted, row
    const confirmed =
      challenge?.consumedAt && challenge.attempts < MAX_ATTEMPTS;
    if (!challenge || confirmed) {
      throw new BadRequestException('No pending registration for this email');
    }

    const now = this.clock.now();
    if (
      challenge.lastSentAt &&
      now.getTime() - challenge.lastSentAt.getTime() <
        RESEND_AFTER_SECONDS * 1000
    ) {
      throw new TooManyRequestsException(
        'Please wait before requesting another email',
      );
    }

    const { secret, ...stored } = this.issueSecret(
      challenge.id,
      challenge.method,
    );
    // The send is claimed under the lock: a resend waiting on it must see the wait
    await this.challenges.update(
      { id: challenge.id },
      { ...stored, attempts: 0, consumedAt: null, lastSentAt: now },
    );
    return { challenge, secret };
  }

  private issueSecret(
    challengeId: string,
    method: RegistrationMethod,
  ): {
    secret: string;
    secretHash: string;
    expiresAt: Date;
  } {
    const expiresAt = new Date(
      this.clock.now().getTime() + EXPIRES_IN_SECONDS * 1000,
    );
    if (method === RegistrationMethod.MagicLink) {
      const token = this.secretHasher.generateToken();
      return {
        secret: token,
        secretHash: this.secretHasher.digestToken(token),
        expiresAt,
      };
    }
    const code = this.secretHasher.generateCode();
    return {
      secret: code,
      secretHash: this.secretHasher.digestCode(challengeId, code),
      expiresAt,
    };
  }

  private verificationResult(
    challenge: RegistrationChallenge,
  ): VerificationResult {
    return {
      kind: 'verification',
      confirmationRequired: true,
      method: challenge.method,
      attemptId: challenge.id,
      expiresInSeconds: EXPIRES_IN_SECONDS,
      resendAfterSeconds: RESEND_AFTER_SECONDS,
    };
  }

  private async sendVerification(
    email: string,
    challenge: RegistrationChallenge,
    secret: string,
    previousSentAt: Date | null,
  ): Promise<void> {
    const context = {
      userId: challenge.userId,
      attemptId: challenge.id,
      method: challenge.method,
    };
    const mail =
      challenge.method === RegistrationMethod.MagicLink
        ? buildMagicLinkMail(email, this.magicLink(secret))
        : buildOtpMail(email, secret);

    try {
      await this.mailService.send(mail);
    } catch (error) {
      // Only a successful delivery starts the wait, so a failed one gives the claim back
      await this.challenges.update(
        { id: challenge.id },
        { lastSentAt: previousSentAt },
      );
      if (error instanceof MailDeliveryError) {
        this.logger.warn({ event: 'verification.send_failed', ...context });
        throw new ServiceUnavailableException(
          'Verification email could not be sent',
        );
      }
      throw error;
    }

    this.logger.log({ event: 'verification.sent', ...context });
  }

  private async rejectingDuplicates<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation;
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) {
        this.logger.warn({ event: 'register.rejected', reason: 'duplicate' });
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  private isVerificationEnabled(): boolean {
    return (
      String(this.config.get('REGISTRATION_VERIFICATION_ENABLED')) === 'true'
    );
  }

  private verificationMethod(): RegistrationMethod {
    return this.config.get('REGISTRATION_VERIFICATION_METHOD') === 'magic_link'
      ? RegistrationMethod.MagicLink
      : RegistrationMethod.Otp;
  }

  private magicLink(token: string): string {
    const link = new URL(this.config.get('REGISTRATION_MAGIC_LINK_BASE_URL'));
    link.searchParams.set('token', token);
    return link.toString();
  }
}
