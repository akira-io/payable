import type { RevolutBusinessRequest } from './revolut-business-types';

export const REVOLUT_ACCOUNTING_PAGE_SIZE = 500;
export const REVOLUT_ACCOUNTING_DEFAULT_LIMIT = 100;

interface CursorPage<T> {
  items: T[];
  nextPageToken?: string;
}

export async function collectRevolutAccountingPages<T>(
  request: RevolutBusinessRequest,
  path: string,
  resultKey: string,
  requestedLimit = REVOLUT_ACCOUNTING_DEFAULT_LIMIT,
): Promise<T[]> {
  const limit = Math.max(0, requestedLimit);
  const results: T[] = [];
  let pageToken: string | undefined;
  while (results.length < limit) {
    const query = new URLSearchParams({
      limit: String(Math.min(limit - results.length, REVOLUT_ACCOUNTING_PAGE_SIZE)),
    });
    if (pageToken) {
      query.set('page_token', pageToken);
    }
    const body = await request<Record<string, unknown>>(`${path}?${query}`, { method: 'GET' });
    const page = accountingPage<T>(body, resultKey);
    results.push(...page.items.slice(0, limit - results.length));
    if (!page.nextPageToken || page.items.length === 0) {
      break;
    }
    pageToken = page.nextPageToken;
  }
  return results;
}

function accountingPage<T>(body: Record<string, unknown>, resultKey: string): CursorPage<T> {
  const items = body[resultKey];
  return {
    items: Array.isArray(items) ? (items as T[]) : [],
    nextPageToken: typeof body.next_page_token === 'string' ? body.next_page_token : undefined,
  };
}
