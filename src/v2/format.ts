// v2 number formatting: idle-game style short numbers (1.2K, 34.5M, 7.8aa) and clock times.
const UNITS = ['', 'K', 'M', 'B', 'T'];

export function big(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n < 1000) return n < 10 && n % 1 !== 0 ? n.toFixed(1) : String(Math.floor(n));
  let u = 0;
  while (n >= 1000 && u < 200) { n /= 1000; u++; }
  const unit = u < UNITS.length ? UNITS[u] : letters(u - UNITS.length);
  return `${n >= 100 ? Math.floor(n) : n >= 10 ? n.toFixed(1) : n.toFixed(2)}${unit}`;
}

function letters(k: number): string {
  const a = 'abcdefghijklmnopqrstuvwxyz';
  return a[Math.floor(k / 26) % 26] + a[k % 26];
}

export function clock(s: number): string {
  s = Math.max(0, Math.ceil(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}
