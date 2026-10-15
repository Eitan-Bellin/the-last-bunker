/**
 * Text size. [plan4:AC-1] The value now lives in utils/a11y.ts (`textScale`, the single source for every accessibility
 * preference); this file keeps the names the menu and main.ts already use. The stylesheets scale every font through --fs.
 */
import { TEXT_SCALES, getA11y, initA11y, setA11y } from '../utils/a11y';

export type TextSize = 'normal' | 'large' | 'xlarge' | 'xxlarge';

const ORDER: TextSize[] = ['normal', 'large', 'xlarge', 'xxlarge'];

export function currentTextSize(): TextSize {
  const scale = getA11y().textScale;
  // 1.0 is only reachable from a hand-edited save: show it as the smallest step.
  const i = TEXT_SCALES.findIndex(s => s >= scale);
  return ORDER[i < 0 ? ORDER.length - 1 : i];
}

/** Applies the stored preference to the page (called once at start-up, before the game loads). */
export function applyTextSize(): void {
  initA11y();
}

/** Moves to the next size, applies and remembers it. */
export function cycleTextSize(): TextSize {
  const next = ORDER[(ORDER.indexOf(currentTextSize()) + 1) % ORDER.length];
  setA11y({ textScale: TEXT_SCALES[ORDER.indexOf(next)] });
  return next;
}
