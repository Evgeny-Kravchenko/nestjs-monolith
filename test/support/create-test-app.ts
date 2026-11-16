import { randomUUID } from 'node:crypto';

import { LoggerService, ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';

import { AppModule } from '@/core/app/app.module';
import { CLOCK } from '@/core/clock/clock';
import { ConfigService } from '@/core/config/config.service';
import { Config } from '@/core/config/config.types';
import { MailService } from '@/core/mail/mail.service';

import { FixedClock } from './fixed-clock';
import { InMemoryMailService } from './in-memory-mail.service';

export type EnvOverrides = Partial<Record<keyof Config, string>>;

export interface TestApp {
  app: NestFastifyApplication;
  clock: FixedClock;
  mail: InMemoryMailService;
  logger: CapturingLogger;
  close(): Promise<void>;
}

let transactionalContextInitialized = false;

export class CapturingLogger implements LoggerService {
  readonly lines: string[] = [];

  log(...args: unknown[]): void {
    this.capture('log', args);
  }

  error(...args: unknown[]): void {
    this.capture('error', args);
  }

  warn(...args: unknown[]): void {
    this.capture('warn', args);
  }

  debug(...args: unknown[]): void {
    this.capture('debug', args);
  }

  verbose(...args: unknown[]): void {
    this.capture('verbose', args);
  }

  fatal(...args: unknown[]): void {
    this.capture('fatal', args);
  }

  private capture(level: string, args: unknown[]): void {
    this.lines.push(`${level} ${JSON.stringify(args)}`);
  }
}

// ConfigService serves the env snapshot validated when ConfigModule is first imported,
// so per-app overrides must replace the service rather than mutate process.env
class OverridableConfigService extends ConfigService {
  constructor(private readonly overrides: EnvOverrides) {
    super();
  }

  get<T extends keyof Config>(key: T): string {
    const override = this.overrides[key];
    return override !== undefined ? override : super.get(key);
  }
}

export async function createTestApp(
  options: { env?: EnvOverrides } = {},
): Promise<TestApp> {
  if (!transactionalContextInitialized) {
    initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });
    transactionalContextInitialized = true;
  }

  const clock = new FixedClock();
  const mail = new InMemoryMailService();
  const logger = new CapturingLogger();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(new OverridableConfigService(options.env ?? {}))
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(MailService)
    .useValue(mail)
    .setLogger(logger)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger },
  );
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return { app, clock, mail, logger, close: () => app.close() };
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}+${randomUUID().slice(0, 8)}@example.test`;
}

export function expectNoSecretsLogged(
  logger: CapturingLogger,
  secrets: string[],
): void {
  const output = logger.lines.join('\n');
  for (const secret of secrets.filter((s) => s.length > 0)) {
    expect(output).not.toContain(secret);
  }
}
