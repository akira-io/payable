export function isUniqueConstraintViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; errno?: unknown; message?: unknown };
  return (
    candidate.code === 'P2002' ||
    candidate.code === '23505' ||
    candidate.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    candidate.code === 'ER_DUP_ENTRY' ||
    candidate.errno === 1062 ||
    (typeof candidate.message === 'string' &&
      /unique constraint|duplicate entry/i.test(candidate.message))
  );
}
