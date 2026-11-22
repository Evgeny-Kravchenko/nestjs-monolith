import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseFilters,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';

import { ConfirmRegistrationDto } from './dto/confirm-registration.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendRegistrationDto } from './dto/resend-registration.dto';
import { UserResponse } from './dto/user.response';
import { VerificationRequiredResponse } from './dto/verification-required.response';
import { RegistrationThrottlerGuard } from './registration-throttler.guard';
import { RegistrationValidationLogFilter } from './registration-validation-log.filter';
import { RegistrationService } from './registration.service';

// Named throttlers must be skipped by name: confirm and resend skip only 'registration'
@ApiTags('registration')
@Controller('auth/register')
@UseGuards(RegistrationThrottlerGuard)
export class RegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}

  // The global pipe does not transform, so the normalized email needs a handler-level pipe
  // A class, not an instance: Nest then injects the HTTP adapter the base filter replies with
  @Post()
  @UseFilters(RegistrationValidationLogFilter)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    operationId: 'register',
    summary: 'Create an account with email and password',
  })
  @ApiCreatedResponse({
    type: UserResponse,
    description: 'Account created and active (verification disabled)',
  })
  @ApiAcceptedResponse({
    type: VerificationRequiredResponse,
    description: 'Account pending; verification email sent',
  })
  @ApiBadRequestResponse({
    description: 'Invalid email or password policy violation',
  })
  @ApiConflictResponse({
    description: 'Email already registered (active or pending)',
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many registration requests from this client',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Verification email could not be sent; the pending account is kept',
  })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<UserResponse | VerificationRequiredResponse> {
    const result = await this.registrationService.register(dto);
    if (result.kind === 'created') {
      return UserResponse.from(result.user);
    }
    reply.status(HttpStatus.ACCEPTED);
    return VerificationRequiredResponse.from(result);
  }

  @Post('confirm')
  @SkipThrottle({ registration: true })
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    operationId: 'confirmRegistration',
    summary: 'Confirm a pending registration with a code or a link token',
  })
  @ApiOkResponse({ type: UserResponse, description: 'Account activated' })
  @ApiBadRequestResponse({
    description:
      'Malformed request; incorrect, unknown, already confirmed, or expired code or token',
  })
  @ApiTooManyRequestsResponse({
    description: 'Attempt locked after 5 wrong code entries; request a resend',
  })
  async confirm(@Body() dto: ConfirmRegistrationDto): Promise<UserResponse> {
    return UserResponse.from(await this.registrationService.confirm(dto));
  }

  @Post('resend')
  @SkipThrottle({ registration: true })
  @HttpCode(HttpStatus.ACCEPTED)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    operationId: 'resendRegistrationVerification',
    summary: 'Send a new verification email for a pending account',
  })
  @ApiAcceptedResponse({
    type: VerificationRequiredResponse,
    description: 'New verification email sent',
  })
  @ApiBadRequestResponse({
    description:
      'Invalid email, or no pending registration for this email (same response for unknown and active addresses)',
  })
  @ApiTooManyRequestsResponse({
    description: 'Previous email delivered less than 60 s ago',
  })
  @ApiServiceUnavailableResponse({
    description: 'Verification email could not be sent',
  })
  async resend(
    @Body() dto: ResendRegistrationDto,
  ): Promise<VerificationRequiredResponse> {
    return VerificationRequiredResponse.from(
      await this.registrationService.resend(dto),
    );
  }
}
