import { z } from 'zod';

export const MAX_LIST_LIMIT = 100;

const RFC_3339_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt]([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export const rfc3339DateTimeSchema = z
  .string()
  .refine(
    (value) => {
      const match = RFC_3339_DATETIME.exec(value);
      if (!match) return false;
      const [, year, month, day] = match;
      const date = new Date(Date.UTC(Number(year), Number(month), 0));
      return Number(day) <= date.getUTCDate() && !Number.isNaN(new Date(value).getTime());
    },
    { message: 'Expected an RFC 3339 datetime string' },
  )
  .transform((value) => new Date(value));
