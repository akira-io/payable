export function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; errno?: number; message?: string };
  if (
    candidate.code === '23505' ||
    candidate.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    candidate.code === 'ER_DUP_ENTRY' ||
    candidate.errno === 1062
  ) {
    return true;
  }
  return typeof candidate.message === 'string' && /unique/i.test(candidate.message);
}
