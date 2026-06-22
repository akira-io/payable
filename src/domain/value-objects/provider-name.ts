const PATTERN = /^[a-z][a-z0-9_-]*$/;

export class ProviderName {
  private constructor(private readonly value: string) {}

  static of(name: string): ProviderName {
    const normalized = name.trim().toLowerCase();
    if (!PATTERN.test(normalized)) {
      throw new TypeError(`Invalid provider name: ${name}`);
    }
    return new ProviderName(normalized);
  }

  toString(): string {
    return this.value;
  }

  equals(other: ProviderName): boolean {
    return this.value === other.value;
  }
}
