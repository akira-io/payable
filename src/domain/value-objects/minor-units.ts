const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

export function divideMinorBig(amount: bigint, divisor: bigint, context: string): number {
  if (divisor === 0n) {
    throw new RangeError('Cannot divide money by zero');
  }
  const sign = (amount < 0n ? -1n : 1n) * (divisor < 0n ? -1n : 1n);
  const a = amount < 0n ? -amount : amount;
  const d = divisor < 0n ? -divisor : divisor;
  const quotient = a / d;
  const remainder = a - quotient * d;
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
  const signed = sign * rounded;
  if (signed > MAX_SAFE_MINOR || signed < -MAX_SAFE_MINOR) {
    throw new RangeError(
      `Money ${context} (${signed}) exceeds the safe integer range; values beyond 2^53-1 lose precision`,
    );
  }
  return Number(signed);
}
