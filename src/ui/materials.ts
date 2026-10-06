/**
 * Plan 2026-10 M7 (painted UI materials, first step): the steel of the HUD plates and the console buttons gets a worn,
 * brushed surface (streaks, scratches and soot) instead of a flat CSS gradient. The tile is painted once at start with Canvas 2D
 * (a 128 px square, a few KB as a data URL), published as the CSS variable `--mat-steel`, and laid over the plates as an
 * overlay-blended layer by bunker-os.css. No image files, no WebGL, no per-frame cost.
 */
function rnd(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function steelTile(): string {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(128,128,128,1)';
  g.fillRect(0, 0, N, N);
  const r = rnd(20261006);
  g.lineCap = 'round';
  // Brushed streaks: long thin horizontal lines, light and dark, wrapped so the tile repeats cleanly.
  for (let i = 0; i < 260; i++) {
    const y = r() * N, x = r() * N, len = 16 + r() * 70;
    g.strokeStyle = r() < 0.5 ? `rgba(255,255,255,${0.05 + r() * 0.12})` : `rgba(0,0,0,${0.06 + r() * 0.14})`;
    g.lineWidth = 0.5 + r() * 0.7;
    for (const dx of [-N, 0, N]) {
      g.beginPath();
      g.moveTo(x + dx, y);
      g.lineTo(x + dx + len, y + (r() - 0.5) * 0.6);
      g.stroke();
    }
  }
  // Scratches: a few bright diagonal hairlines.
  for (let i = 0; i < 12; i++) {
    const x = r() * N, y = r() * N, a = -0.5 + r() * 1.0, len = 10 + r() * 36;
    g.strokeStyle = `rgba(255,255,255,${0.18 + r() * 0.22})`;
    g.lineWidth = 0.4;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  // Soot and grease: soft dark blots and fine specks.
  for (let i = 0; i < 18; i++) {
    const x = r() * N, y = r() * N, rad = 3 + r() * 9;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(0,0,0,${0.1 + r() * 0.1})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(0,0,0,${0.12 + r() * 0.2})`;
    g.fillRect(r() * N, r() * N, 0.8 + r(), 0.8 + r());
  }
  return c.toDataURL('image/png');
}

/** Paints the UI materials and publishes them as CSS variables (call once before the HUD is built). */
export function installMaterials(): void {
  try {
    document.documentElement.style.setProperty('--mat-steel', `url(${steelTile()})`);
  } catch {
    // no canvas: the plates simply stay as plain gradients
  }
}
