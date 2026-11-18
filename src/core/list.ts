import type { List, ListParams } from '../types';

type FetchPage<T, P> = (params: P) => Promise<List<T>>;

/**
 * What every list method returns. Await it for one page, or iterate it to walk every page:
 *
 *   const page = await pickriders.orders.list({ limit: 50 });
 *   for await (const order of pickriders.orders.list({ status: 'delivered' })) { … }
 *
 * Nothing is fetched until you do one or the other.
 */
export class ListPromise<T extends { id: string }, P extends ListParams = ListParams>
  implements PromiseLike<List<T>>, AsyncIterable<T>
{
  private first: Promise<List<T>> | undefined;

  constructor(
    private readonly fetchPage: FetchPage<T, P>,
    private readonly params: P,
  ) {}

  private page(): Promise<List<T>> {
    return (this.first ??= this.fetchPage(this.params));
  }

  then<A = List<T>, B = never>(
    onfulfilled?: ((value: List<T>) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.page().then(onfulfilled, onrejected);
  }

  catch<B = never>(onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<List<T> | B> {
    return this.page().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<List<T>> {
    return this.page().finally(onfinally);
  }

  /** Newest first, page by page. With `ending_before`, walks towards newer objects instead. */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let page = await this.page();
    const backwards = Boolean(this.params.ending_before);
    for (;;) {
      yield* page.data;
      if (!page.has_more || page.data.length === 0) return;
      const edge = backwards ? page.data[0]! : page.data[page.data.length - 1]!;
      page = await this.fetchPage(
        backwards ? { ...this.params, ending_before: edge.id } : { ...this.params, starting_after: edge.id },
      );
    }
  }

  /** Every item across pages, up to `max` (default 1,000, so a mistake can't load a whole history). */
  async toArray({ max = 1_000 }: { max?: number } = {}): Promise<T[]> {
    const items: T[] = [];
    for await (const item of this) {
      if (items.length >= max) break;
      items.push(item);
    }
    return items;
  }
}
