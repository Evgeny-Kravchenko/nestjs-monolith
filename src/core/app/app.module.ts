import { Module } from '@nestjs/common';

import { ClockModule } from '@/core/clock/clock.module';
import { ConfigModule } from '@/core/config/config.module';
import { DatabaseModule } from '@/core/database/database.module';
import { HealthModule } from '@/core/health/health.module';
import { MailModule } from '@/core/mail/mail.module';
import { ThrottlerModule } from '@/core/throttler/throttler.module';

import { AuthModule } from '@/modules/auth/auth.module';
import { UsersModule } from '@/modules/users/users.module';

@Module({
  imports: [
    ClockModule,
    ConfigModule,
    DatabaseModule,
    HealthModule,
    MailModule,
    ThrottlerModule,
    AuthModule,
    UsersModule,
  ],
})
export class AppModule {}
