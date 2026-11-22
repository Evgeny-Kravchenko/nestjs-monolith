import { ApiProperty } from '@nestjs/swagger';

import { RegistrationMethod } from '../registration-method.enum';
import type { RegisterResult } from '../registration.service';

export class VerificationRequiredResponse {
  @ApiProperty({ enum: [true] })
  confirmationRequired!: true;

  @ApiProperty({ enum: RegistrationMethod })
  method!: RegistrationMethod;

  @ApiProperty({ format: 'uuid' })
  attemptId!: string;

  @ApiProperty({ type: 'integer', enum: [600] })
  expiresInSeconds!: number;

  @ApiProperty({ type: 'integer', enum: [60] })
  resendAfterSeconds!: number;

  static from(
    result: Extract<RegisterResult, { kind: 'verification' }>,
  ): VerificationRequiredResponse {
    const response = new VerificationRequiredResponse();
    response.confirmationRequired = result.confirmationRequired;
    response.method = result.method;
    response.attemptId = result.attemptId;
    response.expiresInSeconds = result.expiresInSeconds;
    response.resendAfterSeconds = result.resendAfterSeconds;
    return response;
  }
}
