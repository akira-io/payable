import type { Clock } from '../../domain/contracts/clock.contract';

export class FakeClock implements Clock {
  private current: Date;

  constructor(initial: Date = new Date('2020-01-01T00:00:00.000Z')) {
    this.current = new Date(initial.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}
