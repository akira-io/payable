export async function collectFilteredStripeItems<T extends { id: string }>(
  pages: AsyncIterable<T>,
  matches: (item: T) => boolean,
  limit: number,
): Promise<T[]> {
  const seen = new Set<string>();
  const collected: T[] = [];
  for await (const item of pages) {
    if (seen.has(item.id)) {
      break;
    }
    seen.add(item.id);
    if (!matches(item)) {
      continue;
    }
    collected.push(item);
    if (collected.length >= limit) {
      break;
    }
  }
  return collected;
}
