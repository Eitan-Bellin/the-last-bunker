import { rng } from './math';

/**
 * A 128x128 tileable RGBA value-noise texture generated at start-up (no image files). Each channel is one octave:
 * r = 4 cells per tile, g = 8, b = 16, a = 32. Materials sample it with planar coordinates; one texture fetch replaces
 * the 8-hash arithmetic noise that made the first version of the shader too heavy for integrated GPUs.
 */
export function makeNoise(size = 128): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const r = rng(99);
  const cellsList = [4, 8, 16, 32];
  cellsList.forEach((cells, ch) => {
    const g = new Float32Array(cells * cells).map(() => r());
    const at = (i: number, j: number) => g[((j + cells) % cells) * cells + ((i + cells) % cells)];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells, fy = (y / size) * cells;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        let tx = fx - ix, ty = fy - iy;
        tx = tx * tx * (3 - 2 * tx);
        ty = ty * ty * (3 - 2 * ty);
        const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
        const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
        out[(y * size + x) * 4 + ch] = Math.round((a + (b - a) * ty) * 255);
      }
  });
  return out;
}
