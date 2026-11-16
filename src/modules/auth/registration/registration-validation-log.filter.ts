import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

// The validation pipe rejects before the handler runs, so the failure is logged here;
// the base filter then sends the same 400 body the global handler would
@Catch(BadRequestException)
export class RegistrationValidationLogFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('Registration');

  catch(exception: BadRequestException, host: ArgumentsHost): void {
    this.logger.warn({ event: 'register.rejected', reason: 'validation' });
    super.catch(exception, host);
  }
}
