import { Module } from '@nestjs/common';
import { ThrottlerModule as NestThrottlerModule } from '@nestjs/throttler';

import { ConfigModule } from '@/core/config/config.module';
import { ConfigService } from '@/core/config/config.service';

import { throttlerOptions } from './throttler-options';

// No global guard: routes opt in with @UseGuards, so /health stays unthrottled
@Module({
  imports: [
    NestThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: throttlerOptions,
    }),
  ],
  exports: [NestThrottlerModule],
})
export class ThrottlerModule {}
