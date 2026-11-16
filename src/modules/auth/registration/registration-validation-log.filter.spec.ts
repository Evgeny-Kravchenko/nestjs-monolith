import {
  ArgumentsHost,
  BadRequestException,
  HttpServer,
  Logger,
} from '@nestjs/common';

import { RegistrationValidationLogFilter } from './registration-validation-log.filter';

describe('RegistrationValidationLogFilter', () => {
  const reply = { kind: 'fastify-reply' };
  const host = {
    getArgByIndex: (index: number) => (index === 1 ? reply : undefined),
  } as unknown as ArgumentsHost;

  let adapter: jest.Mocked<Pick<HttpServer, 'reply' | 'isHeadersSent' | 'end'>>;
  let filter: RegistrationValidationLogFilter;
  let warnSpy: jest.SpiedFunction<Logger['warn']>;

  beforeEach(() => {
    adapter = {
      reply: jest.fn(),
      isHeadersSent: jest.fn().mockReturnValue(false),
      end: jest.fn(),
    };
    filter = new RegistrationValidationLogFilter(
      adapter as unknown as HttpServer,
    );
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should log register.rejected with reason validation and nothing else', () => {
    filter.catch(new BadRequestException(['email must be an email']), host);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith({
      event: 'register.rejected',
      reason: 'validation',
    });
  });

  it('should answer with the original 400 body unchanged', () => {
    const exception = new BadRequestException([
      'email must be an email',
      'password must be longer than or equal to 8 characters',
    ]);

    filter.catch(exception, host);

    expect(adapter.reply).toHaveBeenCalledWith(
      reply,
      exception.getResponse(),
      400,
    );
  });
});
