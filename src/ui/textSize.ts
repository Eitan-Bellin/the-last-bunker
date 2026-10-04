/** Text size: a device preference (not part of the save). The stylesheets scale every font through the --fs variable. */
export type TextSize = 'normal' | 'large' | 'xlarge';

const KEY = 'lastbunker_textsize';
const ORDER: TextSize[] = ['normal', 'large', 'xlarge'];
const SCALE: Record<TextSize, number> = { normal: 1.1, large: 1.25, xlarge: 1.4 };

export function currentTextSize(): TextSize {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'large' || v === 'xlarge' || v === 'normal') return v;
  } catch {
    // storage blocked: the default
  }
  return 'normal';
}

export function applyTextSize(size: TextSize = currentTextSize()): void {
  document.documentElement.style.setProperty('--fs', String(SCALE[size]));
}

/** Moves to the next size, applies and remembers it. */
export function cycleTextSize(): TextSize {
  const next = ORDER[(ORDER.indexOf(currentTextSize()) + 1) % ORDER.length];
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // the choice lasts for this session only
  }
  applyTextSize(next);
  return next;
}
