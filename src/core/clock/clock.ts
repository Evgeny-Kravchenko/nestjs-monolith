import { Injectable } from '@nestjs/common';

/**
 * Source of the current time. Inject it via the `CLOCK` token instead of
 * calling `new Date()` so expiry and cooldown logic can be tested with a
 * controllable clock.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
