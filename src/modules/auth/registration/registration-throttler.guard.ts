import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { TooManyRequestsException } from './too-many-requests.exception';

// Throttled requests never reach the handler, so the guard is the only place to log them
@Injectable()
export class RegistrationThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger('Registration');

  protected throwThrottlingException(context: ExecutionContext): Promise<void> {
    const handler = context.getHandler().name;
    if (handler === 'register') {
      this.logger.warn({ event: 'register.rejected', reason: 'throttled' });
    } else {
      this.logger.warn({ event: 'request.throttled', handler });
    }
    // The library's ThrottlerException would answer without the `error` field of the envelope
    return Promise.reject(new TooManyRequestsException('Too many requests'));
  }
}
