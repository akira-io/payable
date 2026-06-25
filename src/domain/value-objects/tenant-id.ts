import { normalizeIdentifier } from './identifier';

export class TenantId {
  private constructor(private readonly value: string) {}

  static of(value: string): TenantId {
    return new TenantId(normalizeIdentifier(value, 'Tenant id'));
  }

  toString(): string {
    return this.value;
  }

  equals(other: TenantId): boolean {
    return this.value === other.value;
  }
}
