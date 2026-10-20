import { compressToUTF16 } from 'lz-string';

/**
 * Compresses the save off the main thread (the same LZ-string UTF-16 format as before, so every older save stays readable).
 * A late-game save is ~75 KB of JSON and used to take 12-40 ms to compress in the middle of the game.
 */
self.onmessage = (e: MessageEvent<{ id: number; json: string }>) => {
  const { id, json } = e.data;
  try {
    (self as unknown as Worker).postMessage({ id, out: compressToUTF16(json) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
