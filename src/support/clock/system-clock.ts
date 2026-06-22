import type { Clock } from '../../domain/contracts/clock.contract';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
