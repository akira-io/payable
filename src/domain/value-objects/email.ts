import { z } from 'zod';

const emailSchema = z.string().trim().email();

export class Email {
  private constructor(private readonly value: string) {}

  static of(value: string): Email {
    const result = emailSchema.safeParse(value);
    if (!result.success) {
      throw new TypeError(`Invalid email address: ${value}`);
    }
    return new Email(result.data.toLowerCase());
  }

  toString(): string {
    return this.value;
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }
}
