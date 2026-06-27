export function isPrismaUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string };
  if (candidate.code === 'P2002') {
    return true;
  }
  return typeof candidate.message === 'string' && /unique constraint/i.test(candidate.message);
}
