import { ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorage } from '@nestjs/throttler';

import { RegistrationThrottlerGuard } from './registration-throttler.guard';
import { TooManyRequestsException } from './too-many-requests.exception';

// Exposes the protected hook under test
class TestableGuard extends RegistrationThrottlerGuard {
  reject(context: ExecutionContext): Promise<void> {
    return this.throwThrottlingException(context);
  }
}

describe('RegistrationThrottlerGuard', () => {
  let guard: TestableGuard;
  let warnSpy: jest.SpiedFunction<Logger['warn']>;

  const contextFor = (handlerName: string): ExecutionContext => {
    const handlers: Record<string, () => void> = {
      [handlerName]: () => undefined,
    };
    return {
      getHandler: () => handlers[handlerName],
      getClass: () => class RegistrationController {},
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    guard = new TestableGuard([], {} as ThrottlerStorage, new Reflector());
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should log register.rejected with reason throttled for the register handler', async () => {
    await expect(guard.reject(contextFor('register'))).rejects.toBeInstanceOf(
      TooManyRequestsException,
    );

    expect(warnSpy).toHaveBeenCalledWith({
      event: 'register.rejected',
      reason: 'throttled',
    });
  });

  it.each(['confirm', 'resend'])(
    'should log request.throttled with the handler name for %s',
    async (handler) => {
      await expect(guard.reject(contextFor(handler))).rejects.toBeInstanceOf(
        TooManyRequestsException,
      );

      expect(warnSpy).toHaveBeenCalledWith({
        event: 'request.throttled',
        handler,
      });
    },
  );

  it('should answer 429 with the shared error envelope', async () => {
    const error = await guard
      .reject(contextFor('register'))
      .catch((e: unknown) => e);

    expect((error as TooManyRequestsException).getStatus()).toBe(429);
    expect((error as TooManyRequestsException).getResponse()).toEqual({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Too many requests',
    });
  });
});
