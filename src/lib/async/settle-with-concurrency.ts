import { mapWithConcurrency } from './map-with-concurrency'

export type IndexedSettledResult<TResult> =
  | { status: 'fulfilled'; index: number; value: TResult }
  | { status: 'rejected'; index: number; reason: unknown }

/**
 * Promise.allSettled semantics with a hard concurrency ceiling and stable
 * source indexes. This is used by browser uploads so a large selection cannot
 * immediately overflow the server-side image decoding/upload permit pool.
 */
export async function settleWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
): Promise<Array<IndexedSettledResult<TResult>>> {
  return await mapWithConcurrency(items, concurrency, async (item, index) => {
    try {
      return {
        status: 'fulfilled' as const,
        index,
        value: await mapper(item, index),
      }
    } catch (reason) {
      return {
        status: 'rejected' as const,
        index,
        reason,
      }
    }
  })
}
