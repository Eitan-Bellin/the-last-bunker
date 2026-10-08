/**
 * Plan 4 wave 3 (perf): code the first picture does not need (the Bunker Book's text, the sound synthesis) is a separate chunk, fetched
 * on first use. Every chunk made this way is also fetched once the page is idle after start (`prefetchLazyChunks`), so it is in the
 * service worker's cache and the game keeps working offline; the first use then finds the file already there.
 */
const registry: (() => void)[] = [];

/** `load` must contain the literal `import('...')` (the bundler needs to see the path). The result is fetched once and then kept. */
export function lazyChunk<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  const get = (): Promise<T> => {
    promise ??= load().catch((err: unknown) => {
      promise = null; // a failed fetch (no network yet) can be tried again later
      throw err;
    });
    return promise;
  };
  registry.push(() => { get().catch(() => undefined); });
  return get;
}

/** Run `fn` when the main thread is quiet (or after a few seconds on browsers without requestIdleCallback). */
export function whenIdle(fn: () => void, timeout = 8000): void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric.call(window, fn, { timeout });
  else window.setTimeout(fn, Math.min(timeout, 4000));
}

/** Fetches, one per idle moment, every chunk made with `lazyChunk` that has not been used yet. */
export function prefetchLazyChunks(): void {
  const next = registry.slice();
  const step = (): void => {
    const run = next.shift();
    if (!run) return;
    run();
    whenIdle(step, 4000);
  };
  whenIdle(step);
}
