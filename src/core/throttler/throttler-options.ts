import { ThrottlerOptions } from '@nestjs/throttler';

import type { ConfigService } from '@/core/config/config.service';

// Kept apart from the module so it can be tested without loading ConfigModule's env validation
export function throttlerOptions(config: ConfigService): ThrottlerOptions[] {
  return [
    {
      name: 'default',
      ttl: Number(config.get('THROTTLE_GLOBAL_TTL')),
      limit: Number(config.get('THROTTLE_GLOBAL_LIMIT')),
    },
    {
      name: 'registration',
      ttl: Number(config.get('REGISTRATION_THROTTLE_TTL')),
      limit: Number(config.get('REGISTRATION_THROTTLE_LIMIT')),
    },
  ];
}
