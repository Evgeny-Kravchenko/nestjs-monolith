import { ConfigService } from '@/core/config/config.service';

import { throttlerOptions } from './throttler-options';

describe('throttlerOptions', () => {
  const configWith = (values: Record<string, unknown>): ConfigService =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigService;

  it('should return the default and registration throttlers from config', () => {
    const options = throttlerOptions(
      configWith({
        THROTTLE_GLOBAL_TTL: 10000,
        THROTTLE_GLOBAL_LIMIT: 10,
        REGISTRATION_THROTTLE_TTL: 60000,
        REGISTRATION_THROTTLE_LIMIT: 5,
      }),
    );

    expect(options).toEqual([
      { name: 'default', ttl: 10000, limit: 10 },
      { name: 'registration', ttl: 60000, limit: 5 },
    ]);
  });

  // Overrides arrive as strings (env files, the e2e config override)
  it('should coerce string values to numbers', () => {
    const options = throttlerOptions(
      configWith({
        THROTTLE_GLOBAL_TTL: '2000',
        THROTTLE_GLOBAL_LIMIT: '1000',
        REGISTRATION_THROTTLE_TTL: '30000',
        REGISTRATION_THROTTLE_LIMIT: '3',
      }),
    );

    expect(options).toEqual([
      { name: 'default', ttl: 2000, limit: 1000 },
      { name: 'registration', ttl: 30000, limit: 3 },
    ]);
  });
});
