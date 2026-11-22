import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ConfigService } from '@/core/config/config.service';

import { MailModule } from './mail.module';
import { MailService } from './mail.service';

// Stands in for the global ConfigModule, whose env validation would run on import
@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useValue: {
        get: (key: string) =>
          ({ SMTP_HOST: 'localhost', SMTP_PORT: 1025, MAIL_FROM: 'a@b.c' })[
            key
          ],
      },
    },
  ],
  exports: [ConfigService],
})
class StubConfigModule {}

describe('MailModule', () => {
  it('should export MailService to importing modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StubConfigModule, MailModule],
    }).compile();

    expect(moduleRef.get(MailService)).toBeInstanceOf(MailService);
  });
});
