export class CorrelationId {
  private constructor(private readonly value: string) {}

  static of(value: string): CorrelationId {
    const normalized = value.trim();
    if (normalized.length === 0) {
      throw new TypeError('Correlation id cannot be empty');
    }
    return new CorrelationId(normalized);
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
