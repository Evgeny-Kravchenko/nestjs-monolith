import { Test, TestingModule } from '@nestjs/testing';

import { Clock, CLOCK, SystemClock } from './clock';
import { ClockModule } from './clock.module';

describe('ClockModule', () => {
  let clock: Clock;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ClockModule],
    }).compile();

    clock = module.get<Clock>(CLOCK);
  });

  it('should provide SystemClock under the CLOCK token', () => {
    expect(clock).toBeInstanceOf(SystemClock);
  });

  it('should return the current time', () => {
    const before = Date.now();
    const now = clock.now().getTime();
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});
