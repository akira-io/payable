import { normalizeIdentifier } from './identifier';

export class CorrelationId {
  private constructor(private readonly value: string) {}

  static of(value: string): CorrelationId {
    return new CorrelationId(normalizeIdentifier(value, 'Correlation id'));
  }

  static generate(): CorrelationId {
    return new CorrelationId(globalThis.crypto.randomUUID());
  }

  toString(): string {
    return this.value;
  }

  equals(other: CorrelationId): boolean {
    return this.value === other.value;
  }
}
