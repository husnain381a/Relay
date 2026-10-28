export interface PageOptions {
  offset?: number;
  limit?: number;
}
export interface OffsetPage<T> {
  items: T[];
  hasMore: boolean;
  nextOffset: number | null;
}
export function pageOptions(options: PageOptions = {}) {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error("Invalid page offset.");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Choose a page size between 1 and 100.");
  return { offset, limit };
}
export function offsetPage<T>(
  rows: T[],
  options: Required<PageOptions>,
): OffsetPage<T> {
  const items = rows.slice(0, options.limit);
  const hasMore = rows.length > options.limit;
  return {
    items,
    hasMore,
    nextOffset: hasMore ? options.offset + items.length : null,
  };
}
/** Offset pages can overlap after concurrent inserts; update, rather than duplicate, known rows. */
export function appendUnique<T>(
  current: T[],
  incoming: T[],
  key: (item: T) => string,
): T[] {
  const result = [...current];
  const indexes = new Map(result.map((item, index) => [key(item), index]));
  for (const item of incoming) {
    const index = indexes.get(key(item));
    if (index === undefined) {
      indexes.set(key(item), result.length);
      result.push(item);
    } else result[index] = item;
  }
  return result;
}
/** A request may commit only while both its logical scope and latest-request ticket match. */
export function createRequestGuard() {
  let generation = 0;
  return {
    invalidate() {
      generation += 1;
    },
    begin() {
      const ticket = ++generation;
      return () => ticket === generation;
    },
  };
}
