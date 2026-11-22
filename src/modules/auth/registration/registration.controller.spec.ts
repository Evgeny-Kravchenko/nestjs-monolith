import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FastifyReply } from 'fastify';

import { User } from '@/modules/users/user.entity';
import { UserStatus } from '@/modules/users/user-status.enum';

import { RegisterDto } from './dto/register.dto';
import { UserResponse } from './dto/user.response';
import { VerificationRequiredResponse } from './dto/verification-required.response';
import { RegistrationController } from './registration.controller';
import { RegistrationMethod } from './registration-method.enum';
import { RegistrationThrottlerGuard } from './registration-throttler.guard';
import { RegistrationService } from './registration.service';

describe('RegistrationController', () => {
  const dto: RegisterDto = { email: 'new@example.com', password: 'секрет12' };
  const attemptId = '6f1c2a9e-3b7d-4c5e-9f80-1a2b3c4d5e6f';

  const makeUser = (status: UserStatus): User =>
    Object.assign(new User(), {
      id: 'user-id',
      email: dto.email,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$salt$hash',
      status,
    });

  let controller: RegistrationController;
  let registrationService: jest.Mocked<
    Pick<RegistrationService, 'register' | 'confirm' | 'resend'>
  >;
  let status: jest.Mock;
  let reply: FastifyReply;

  beforeEach(async () => {
    registrationService = {
      register: jest.fn(),
      confirm: jest.fn(),
      resend: jest.fn(),
    };
    status = jest.fn();
    reply = { status } as unknown as FastifyReply;

    const moduleRef = await Test.createTestingModule({
      controllers: [RegistrationController],
      providers: [
        { provide: RegistrationService, useValue: registrationService },
      ],
    })
      // Throttling is covered by the guard spec and the e2e suite
      .overrideGuard(RegistrationThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(RegistrationController);
  });

  describe('register', () => {
    it('should delegate to the service and return only id, email and status', async () => {
      registrationService.register.mockResolvedValueOnce({
        kind: 'created',
        user: makeUser(UserStatus.Active),
      });

      const response = await controller.register(dto, reply);

      expect(registrationService.register).toHaveBeenCalledWith(dto);
      expect(response).toBeInstanceOf(UserResponse);
      expect(JSON.parse(JSON.stringify(response))).toEqual({
        id: 'user-id',
        email: dto.email,
        status: 'active',
      });
      expect(status).not.toHaveBeenCalled();
    });

    it('should answer 202 with exactly the verification fields', async () => {
      registrationService.register.mockResolvedValueOnce({
        kind: 'verification',
        confirmationRequired: true,
        method: RegistrationMethod.Otp,
        attemptId,
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });

      const response = await controller.register(dto, reply);

      expect(status).toHaveBeenCalledWith(202);
      expect(response).toBeInstanceOf(VerificationRequiredResponse);
      expect(JSON.parse(JSON.stringify(response))).toEqual({
        confirmationRequired: true,
        method: 'otp',
        attemptId,
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });
    });

    it('should let service errors propagate to the HTTP layer', async () => {
      const conflict = new ConflictException('Email is already registered');
      registrationService.register.mockRejectedValueOnce(conflict);

      await expect(controller.register(dto, reply)).rejects.toBe(conflict);
    });
  });

  describe('confirm', () => {
    const confirmDto = { attemptId, code: '042817' };

    it('should delegate to the service and return only id, email and status', async () => {
      registrationService.confirm.mockResolvedValueOnce(
        makeUser(UserStatus.Active),
      );

      const response = await controller.confirm(confirmDto);

      expect(registrationService.confirm).toHaveBeenCalledWith(confirmDto);
      expect(response).toBeInstanceOf(UserResponse);
      expect(JSON.parse(JSON.stringify(response))).toEqual({
        id: 'user-id',
        email: dto.email,
        status: 'active',
      });
    });

    it('should let service errors propagate to the HTTP layer', async () => {
      const invalid = new BadRequestException(
        'Invalid verification code or token',
      );
      registrationService.confirm.mockRejectedValueOnce(invalid);

      await expect(controller.confirm(confirmDto)).rejects.toBe(invalid);
    });
  });

  describe('resend', () => {
    const resendDto = { email: dto.email };

    it('should delegate to the service and return exactly the verification fields', async () => {
      registrationService.resend.mockResolvedValueOnce({
        kind: 'verification',
        confirmationRequired: true,
        method: RegistrationMethod.Otp,
        attemptId,
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });

      const response = await controller.resend(resendDto);

      expect(registrationService.resend).toHaveBeenCalledWith(resendDto);
      expect(response).toBeInstanceOf(VerificationRequiredResponse);
      expect(JSON.parse(JSON.stringify(response))).toEqual({
        confirmationRequired: true,
        method: 'otp',
        attemptId,
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });
    });

    it('should let service errors propagate to the HTTP layer', async () => {
      const tooSoon = new HttpException(
        'Please wait before requesting another email',
        HttpStatus.TOO_MANY_REQUESTS,
      );
      registrationService.resend.mockRejectedValueOnce(tooSoon);

      await expect(controller.resend(resendDto)).rejects.toBe(tooSoon);
    });
  });
});
