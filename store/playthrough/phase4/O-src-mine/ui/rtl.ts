/**
 * [plan4:UX-22] "From this to that" arrows. A literal "→" typed into a right-to-left line is mirrored by the text engine in some
 * places and not in others, so it can point the wrong way. The icon arrows are drawn shapes: pick the one that points along the
 * reading direction (left in Hebrew, right in English).
 */
export function flowArrow(locale?: string): string {
  const rtl = locale ? locale === 'he' : document.documentElement.dir === 'rtl';
  return rtl ? '[[arrowLeft]]' : '[[arrowRight]]';
}
