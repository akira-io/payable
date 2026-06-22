export class TenantId {
  private constructor(private readonly value: string) {}

  static of(value: string): TenantId {
    const normalized = value.trim();
    if (normalized.length === 0) {
      throw new TypeError('Tenant id cannot be empty');
    }
    return new TenantId(normalized);
  }

  toString(): string {
    return this.value;
  }

  equals(other: TenantId): boolean {
    return this.value === other.value;
  }
}
