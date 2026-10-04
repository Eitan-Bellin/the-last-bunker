/**
 * The game's original icon set: 24×24 filled glyphs in a stamped-metal style.
 * `currentColor` is the main ink; `.55` opacity parts are the secondary tone; `#000` cut-outs read as engraving.
 * Strings can embed icons as [[name]] tokens; see rich() in dom.ts.
 */

const S = 'stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"';
const CUT = 'fill="#000" fill-opacity=".5"';

/** Toothed gear outline (with a center hole) as a single even-odd path. */
function gear(cx: number, cy: number, rOut: number, rIn: number, teeth: number, hole: number): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    const corners: [number, number][] = [
      [a - step * 0.32, rIn], [a - step * 0.2, rOut], [a + step * 0.2, rOut], [a + step * 0.32, rIn],
    ];
    for (const [ang, r] of corners) pts.push(`${(cx + Math.cos(ang) * r).toFixed(2)} ${(cy + Math.sin(ang) * r).toFixed(2)}`);
  }
  const ring = `M${pts.join('L')}Z`;
  const h = `M${cx + hole} ${cy}a${hole} ${hole} 0 1 0 ${-2 * hole} 0a${hole} ${hole} 0 1 0 ${2 * hole} 0Z`;
  return `<path fill-rule="evenodd" d="${ring}${h}"/>`;
}

const TREFOIL = '<circle cx="12" cy="12" r="2.2"/>'
  + '<path d="M10.4 9.23 7.25 3.77A9.5 9.5 0 0 1 16.75 3.77L13.6 9.23A3.2 3.2 0 0 0 10.4 9.23Z"/>'
  + '<path d="M15.2 12H21.5A9.5 9.5 0 0 1 16.75 20.23L13.6 14.77A3.2 3.2 0 0 0 15.2 12Z"/>'
  + '<path d="M10.4 14.77 7.25 20.23A9.5 9.5 0 0 1 2.5 12H8.8A3.2 3.2 0 0 0 10.4 14.77Z"/>';

export const ICON_SVG = {
  // ── Resources ──────────────────────────────────────────────
  food: '<path d="M5 7v10.5C5 19 8.1 20.2 12 20.2s7-1.2 7-2.7V7c0 1.5-3.1 2.7-7 2.7S5 8.5 5 7z" opacity=".6"/>'
    + '<path d="M5 10.6c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7v4.3c0 1.5-3.1 2.7-7 2.7s-7-1.2-7-2.7z"/>'
    + '<ellipse cx="12" cy="7" rx="7" ry="2.7"/><ellipse cx="12" cy="7" rx="5" ry="1.6" ' + CUT + '/>',
  water: '<path d="M12 2.5C9.2 6.8 5.5 10.4 5.5 14.6a6.5 6.5 0 0 0 13 0C18.5 10.4 14.8 6.8 12 2.5z"/>'
    + '<path d="M8.6 14.6a3.4 3.4 0 0 0 3.4 3.4" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  power: '<path d="M13.6 2 4.8 13.6h6.1L9.4 22l9.8-12.6h-6.3z"/>',
  materials: '<rect x="2.5" y="14.5" width="9" height="5.5" rx=".7"/><rect x="12.5" y="14.5" width="9" height="5.5" rx=".7" opacity=".6"/>'
    + '<rect x="7.5" y="8.2" width="9" height="5.5" rx=".7"/><rect x="2.5" y="8.2" width="4.2" height="5.5" rx=".7" opacity=".6"/>'
    + '<rect x="17.3" y="8.2" width="4.2" height="5.5" rx=".7" opacity=".6"/><rect x="5" y="2" width="9" height="5.5" rx=".7" opacity=".6"/>',
  medicine: '<path d="M9 3.5h6a1.2 1.2 0 0 1 1.2 1.2V7h-2V5.5h-4.4V7h-2V4.7A1.2 1.2 0 0 1 9 3.5z" opacity=".6"/>'
    + '<rect x="2.5" y="7" width="19" height="13.5" rx="2.2"/>'
    + '<path d="M10.5 9.8h3v2.9h2.9v3h-2.9v2.9h-3v-2.9H7.6v-3h2.9z" fill="#fff" fill-opacity=".92"/>',
  knowledge: '<path d="M2.5 5.2c3.1-.9 6.3-.5 8.8 1.3v13.8c-2.6-1.7-5.7-2.1-8.8-1.2z"/>'
    + '<path d="M21.5 5.2c-3.1-.9-6.3-.5-8.8 1.3v13.8c2.6-1.7 5.7-2.1 8.8-1.2z" opacity=".6"/>',
  scrap: '<path fill-rule="evenodd" d="M12 2.3l8.4 4.85v9.7L12 21.7l-8.4-4.85v-9.7zM12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z"/>',
  blueprints: '<rect x="4" y="5" width="16" height="15.5" rx="1" opacity=".6"/>'
    + '<path d="M4 5h16v2.5H4z"/><path d="M7 10h10M7 13h10M7 16h6M10 8.5v10M14 8.5v10" stroke="#fff" stroke-opacity=".5" stroke-width=".9"/>'
    + '<rect x="2.5" y="3" width="19" height="3" rx="1.5"/>',
  isotope7: TREFOIL,
  // [Economy] Trade credits: a stamped coin.
  credits: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="6.6" fill="#000" fill-opacity=".35"/><path d="M13.8 8.6c-.5-.5-1.1-.7-1.9-.7-1.5 0-2.7 1.1-2.7 4.1s1.2 4.1 2.7 4.1c.8 0 1.4-.2 1.9-.7" stroke="#fff" stroke-opacity=".9" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  // ── Survivor stats ─────────────────────────────────────────
  strength: '<rect x="1.5" y="9" width="3" height="6" rx="1"/><rect x="4.5" y="6.2" width="3.6" height="11.6" rx="1"/>'
    + '<rect x="8" y="10.8" width="8" height="2.4" opacity=".6"/><rect x="15.9" y="6.2" width="3.6" height="11.6" rx="1"/><rect x="19.5" y="9" width="3" height="6" rx="1"/>',
  intelligence: '<path d="M12 2.3a6.6 6.6 0 0 0-3.9 11.9c.5.4.8 1 .8 1.6v1.4h6.2v-1.4c0-.6.3-1.2.8-1.6A6.6 6.6 0 0 0 12 2.3z"/>'
    + '<rect x="9" y="18.1" width="6" height="1.6" rx=".6" opacity=".6"/><rect x="10" y="20.4" width="4" height="1.5" rx=".6" opacity=".6"/>'
    + '<path d="M10 8.8a2.2 2.2 0 0 1 2-2" stroke="#fff" stroke-opacity=".6" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
  agility: '<path d="M3 4.5h4.6l7.5 7.5-7.5 7.5H3l7.5-7.5z"/><path d="M10.4 4.5H15l7.5 7.5-7.5 7.5h-4.6l7.5-7.5z" opacity=".6"/>',
  charisma: '<path d="M4 3.8h16a2 2 0 0 1 2 2v9.4a2 2 0 0 1-2 2h-8.6l-5.1 4v-4H4a2 2 0 0 1-2-2V5.8a2 2 0 0 1 2-2z"/>'
    + '<circle cx="8" cy="10.5" r="1.3" ' + CUT + '/><circle cx="12" cy="10.5" r="1.3" ' + CUT + '/><circle cx="16" cy="10.5" r="1.3" ' + CUT + '/>',
  endurance: '<path d="M12 2.3l8.2 3.1v6.3c0 4.8-3.4 8.6-8.2 10-4.8-1.4-8.2-5.2-8.2-10V5.4z"/>'
    + '<path d="M12 4.6v15.1c3.4-1.3 5.8-4.2 5.8-8V7z" ' + CUT + '/>',
  // ── Rooms ──────────────────────────────────────────────────
  quarters: '<rect x="3" y="2.5" width="2.2" height="19" rx=".6"/><rect x="18.8" y="2.5" width="2.2" height="19" rx=".6"/>'
    + '<rect x="5" y="8.3" width="14" height="2.6"/><rect x="5" y="16.3" width="14" height="2.6"/>'
    + '<rect x="5.6" y="5.5" width="5" height="2.6" rx="1.2" opacity=".6"/><rect x="5.6" y="13.5" width="5" height="2.6" rx="1.2" opacity=".6"/>'
    + '<rect x="11" y="6.2" width="7.4" height="1.9" rx=".9" opacity=".35"/><rect x="11" y="14.2" width="7.4" height="1.9" rx=".9" opacity=".35"/>',
  generator: '<rect x="2.5" y="6.5" width="19" height="12" rx="1.6" opacity=".6"/><rect x="6" y="3.5" width="4" height="3"/>'
    + '<rect x="4.5" y="18.5" width="3.5" height="2.5" rx=".5"/><rect x="16" y="18.5" width="3.5" height="2.5" rx=".5"/>'
    + '<path d="M13.4 8.2 9 13.6h3l-1 3.9 4.6-5.8h-3.1l1-3.5z"/>',
  farm: '<path d="M11.3 13.6C6.7 13.8 3.9 11.1 3.5 6.4c4.7-.3 7.7 2.6 7.8 7.2z"/>'
    + '<path d="M12.7 11.6c.2-4.7 3.3-7.5 8-7.5-.1 4.8-3.2 7.6-8 7.5z" opacity=".6"/>'
    + '<rect x="11.2" y="10.5" width="1.6" height="9.5" rx=".5"/><rect x="4.5" y="19" width="15" height="2.6" rx="1.3" opacity=".6"/>',
  waterPump: '<path fill-rule="evenodd" d="M12 1.5a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2zm0 2.1a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/>'
    + '<path d="M11.3 3.6h1.4v5h-1.4zM9.5 5.4h5v1.4h-5z"/><rect x="11" y="10.2" width="2" height="4"/>'
    + '<rect x="2.5" y="13.8" width="19" height="4.2" rx="1" opacity=".6"/>'
    + '<path d="M12 18.8c-.9 1.3-1.6 2-1.6 2.9a1.6 1.6 0 0 0 3.2 0c0-.9-.7-1.6-1.6-2.9z"/>',
  workshop: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  medbay: '<rect x="2.5" y="2.5" width="19" height="19" rx="4.5" opacity=".35"/><path d="M9.6 4.8h4.8v4.8h4.8v4.8h-4.8v4.8H9.6v-4.8H4.8V9.6h4.8z"/>',
  canteen: '<path d="M4 11.2h16v5.8a3.2 3.2 0 0 1-3.2 3.2H7.2A3.2 3.2 0 0 1 4 17z"/>'
    + '<rect x="1.6" y="11.6" width="3.2" height="2" rx="1"/><rect x="19.2" y="11.6" width="3.2" height="2" rx="1"/>'
    + '<rect x="3" y="9" width="18" height="2.2" rx="1.1" opacity=".6"/>'
    + '<path d="M8.5 7c-.9-1 .9-2.1 0-3.6M12 7c-.9-1 .9-2.1 0-3.6M15.5 7c-.9-1 .9-2.1 0-3.6" ' + S + ' stroke-width="1.4" opacity=".6"/>',
  storage: '<rect x="2.5" y="5" width="19" height="15.5" rx="1.4" opacity=".6"/><rect x="2.5" y="5" width="19" height="3.6" rx="1.2"/>'
    + '<path d="M5.5 11.5l13 6M18.5 11.5l-13 6" stroke="currentColor" stroke-width="1.7"/><rect x="10" y="9.8" width="4" height="2" rx=".5" ' + CUT + '/>',
  elevator: '<rect x="4" y="2.5" width="16" height="19" rx="1.5" opacity=".6"/><path d="M12 5l3.6 4.4H8.4zM12 19l-3.6-4.4h7.2z"/>',
  laboratory: '<path d="M9 2.3h6v1.9h-1v5.3l5.7 9.4A2 2 0 0 1 18 22H6a2 2 0 0 1-1.7-3.1L10 9.5V4.2H9z" opacity=".6"/>'
    + '<path d="M7.1 15h9.8l2.8 3.9A2 2 0 0 1 18 22H6a2 2 0 0 1-1.7-3.1z"/><circle cx="10.5" cy="18" r="1" ' + CUT + '/><circle cx="13.5" cy="19.4" r=".8" ' + CUT + '/>',
  radioTower: '<circle cx="12" cy="7" r="2"/><path d="M11 9h2l3.6 13h-2.2L12 12.6 9.6 22H7.4z"/>'
    + '<path d="M7.6 3.6a5.4 5.4 0 0 0 0 6.8M16.4 3.6a5.4 5.4 0 0 1 0 6.8M5 1.6a8.4 8.4 0 0 0 0 10.8M19 1.6a8.4 8.4 0 0 1 0 10.8" ' + S + ' stroke-width="1.5" opacity=".6"/>',
  hydroponics: '<rect x="2" y="15.5" width="20" height="4.5" rx="1.2" opacity=".6"/>'
    + '<path d="M6 15.5V12M12 15.5V10M18 15.5V12" stroke="currentColor" stroke-width="1.4"/>'
    + '<path d="M6 12.4c-2.4 0-3.6-1.4-3.6-3.6 2.4 0 3.6 1.4 3.6 3.6zM6 12.4c0-2.4 1.2-3.6 3.6-3.6 0 2.2-1.2 3.6-3.6 3.6z"/>'
    + '<path d="M12 10.4c-2.6 0-4-1.6-4-4 2.6 0 4 1.6 4 4zM12 10.4c0-2.6 1.4-4 4-4 0 2.4-1.4 4-4 4z"/>'
    + '<path d="M18 12.4c-2.4 0-3.6-1.4-3.6-3.6 2.4 0 3.6 1.4 3.6 3.6zM18 12.4c0-2.4 1.2-3.6 3.6-3.6 0 2.2-1.2 3.6-3.6 3.6z"/>',
  waterPurifier: '<path d="M4 6.8h9.2a3.2 3.2 0 0 1 3.2 3.2v2.2h-3.2v-1.6a1 1 0 0 0-1-1H4z"/><rect x="1.8" y="5.2" width="2.6" height="6" rx=".8"/>'
    + '<rect x="6.8" y="3.6" width="4.4" height="2" rx=".6" opacity=".6"/><rect x="8.3" y="5.2" width="1.4" height="1.8" opacity=".6"/>'
    + '<path d="M14.8 14.2c-1.4 2.1-2.4 3.2-2.4 4.5a2.4 2.4 0 0 0 4.8 0c0-1.3-1-2.4-2.4-4.5z"/>',
  trainingRoom: '<path d="M8.4 10.2V7.6a3.6 3.6 0 0 1 7.2 0v2.6" ' + S + ' stroke-width="2.2"/>'
    + '<path d="M12 8.6a6.6 6.6 0 0 1 6.6 6.6c0 2.4-1.2 4.4-2.7 5.6H8.1c-1.5-1.2-2.7-3.2-2.7-5.6A6.6 6.6 0 0 1 12 8.6z"/>'
    + '<path d="M9 15a3 3 0 0 1 3-3" stroke="#fff" stroke-opacity=".5" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
  armory: '<path d="M4.5 9.2c0-2.6.9-4.8 2.1-6.2 1.2 1.4 2.1 3.6 2.1 6.2v11.3H4.5z"/><path d="M9.9 9.2c0-2.6.9-4.8 2.1-6.2 1.2 1.4 2.1 3.6 2.1 6.2v11.3H9.9z"/>'
    + '<path d="M15.3 9.2c0-2.6.9-4.8 2.1-6.2 1.2 1.4 2.1 3.6 2.1 6.2v11.3h-4.2z"/>'
    + '<path d="M4.5 10.5h4.2v1.2H4.5zM9.9 10.5h4.2v1.2H9.9zM15.3 10.5h4.2v1.2h-4.2z" ' + CUT + '/><rect x="3.5" y="20.2" width="17" height="1.8" rx=".6" opacity=".6"/>',
  reactor: '<g ' + S + ' stroke-width="1.6"><ellipse cx="12" cy="12" rx="10" ry="3.9"/><ellipse cx="12" cy="12" rx="10" ry="3.9" transform="rotate(60 12 12)"/>'
    + '<ellipse cx="12" cy="12" rx="10" ry="3.9" transform="rotate(120 12 12)"/></g><circle cx="12" cy="12" r="2.4"/>',
  // ── Interface ──────────────────────────────────────────────
  menu: '<rect x="3" y="5" width="18" height="2.4" rx="1.2"/><rect x="3" y="10.8" width="18" height="2.4" rx="1.2"/><rect x="3" y="16.6" width="18" height="2.4" rx="1.2"/>',
  close: '<path d="M5.6 4.2 12 10.6l6.4-6.4 1.4 1.4-6.4 6.4 6.4 6.4-1.4 1.4-6.4-6.4-6.4 6.4-1.4-1.4 6.4-6.4-6.4-6.4z"/>',
  people: '<circle cx="9" cy="7.4" r="3.6"/><path d="M2 20.5c0-3.9 3.1-7 7-7s7 3.1 7 7z"/>'
    + '<circle cx="17.2" cy="8.4" r="2.9" opacity=".6"/><path d="M15.6 13.4c.5-.1 1-.2 1.6-.2 3 0 5.6 2.5 5.6 5.6v1.7h-5.1c0-2.8-.8-5.2-2.1-7.1z" opacity=".6"/>',
  person: '<circle cx="12" cy="7" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z"/>',
  worker: '<path d="M4 14.5a8 8 0 0 1 16 0z"/><rect x="2.5" y="14.5" width="19" height="2.8" rx="1.1"/>'
    + '<rect x="10.8" y="5.2" width="2.4" height="5" rx=".6" ' + CUT + '/><path d="M7 19.5h10" stroke="currentColor" stroke-width="1.6" opacity=".6"/>',
  research: '<path d="M10.2 2.2h3.6v1.9h-.5v8h-2.6v-8h-.5z"/><rect x="8.8" y="12.6" width="6.4" height="2" rx=".5"/>'
    + '<path d="M15.6 7.6a7 7 0 0 1 1.7 11.9h2.2v2.3h-15v-2.3h9.4a4.7 4.7 0 0 0 1-9.4z" opacity=".6"/>',
  surface: '<circle cx="12" cy="12" r="9.4" ' + S + ' stroke-width="1.9"/><ellipse cx="12" cy="12" rx="4" ry="9.4" ' + S + ' stroke-width="1.5"/>'
    + '<path d="M2.6 12h18.8M4.2 7h15.6M4.2 17h15.6" ' + S + ' stroke-width="1.5" opacity=".6"/>',
  map: '<path d="M2.5 5.6 8.5 3.4l7 2.6 6-2.2v14.6l-6 2.2-7-2.6-6 2.2z" opacity=".6"/><path d="M8.5 3.4v14.6l7 2.6V6z"/>',
  build: '<g transform="rotate(45 12 12)"><rect x="10.8" y="8" width="2.4" height="14" rx="1"/><path d="M6.2 3h11.6v5H6.2z"/><path d="M17.8 4h2.6v3h-2.6z" opacity=".6"/></g>',
  star: '<path d="M12 2.4l2.95 6 6.6.95-4.78 4.65 1.13 6.57L12 17.47l-5.9 3.1 1.13-6.57L2.45 9.35l6.6-.95z"/>',
  check: '<path d="M9.4 16.4 4.6 11.6l-1.7 1.7 6.5 6.5L21.1 8.1l-1.7-1.7z"/>',
  lock: '<path d="M7 10.5V7.6a5 5 0 0 1 10 0v2.9h-2.3V7.6a2.7 2.7 0 0 0-5.4 0v2.9z" opacity=".6"/><rect x="4.5" y="10.2" width="15" height="11.3" rx="2"/>'
    + '<path d="M12 13.4a1.6 1.6 0 0 1 .8 3v2.2h-1.6v-2.2a1.6 1.6 0 0 1 .8-3z" ' + CUT + '/>',
  warning: '<path fill-rule="evenodd" d="M12 2.3 22.6 20.7H1.4zM10.9 8.8h2.2v6h-2.2zm0 7.6h2.2v2.2h-2.2z"/>',
  clock: '<rect x="9.6" y="1.5" width="4.8" height="2.2" rx=".8"/><path d="M12 4.6a8.6 8.6 0 1 1 0 17.2 8.6 8.6 0 0 1 0-17.2z" opacity=".6"/>'
    + '<path d="M11 8h2v5.6l3.3 2-1 1.7-4.3-2.6z"/>',
  happy: '<circle cx="12" cy="12" r="9.6"/><circle cx="8.8" cy="10" r="1.4" ' + CUT + '/><circle cx="15.2" cy="10" r="1.4" ' + CUT + '/>'
    + '<path d="M7.6 14a4.8 4.8 0 0 0 8.8 0" stroke="#000" stroke-opacity=".5" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
  sad: '<circle cx="12" cy="12" r="9.6"/><circle cx="8.8" cy="10" r="1.4" ' + CUT + '/><circle cx="15.2" cy="10" r="1.4" ' + CUT + '/>'
    + '<path d="M7.8 17a4.8 4.8 0 0 1 8.4 0" stroke="#000" stroke-opacity=".5" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
  heart: '<path d="M12 21s-8.6-5.2-8.6-11.3A4.9 4.9 0 0 1 12 6.8a4.9 4.9 0 0 1 8.6 2.9C20.6 15.8 12 21 12 21z"/>',
  trophy: '<path d="M6.5 3h11v6.2a5.5 5.5 0 0 1-11 0z"/><path d="M6.5 5H3.2v2.2a4 4 0 0 0 3.6 4M17.5 5h3.3v2.2a4 4 0 0 1-3.6 4" ' + S + ' stroke-width="1.6"/>'
    + '<rect x="10.8" y="14.5" width="2.4" height="3.5" opacity=".6"/><rect x="7" y="18" width="10" height="3.2" rx=".8"/>',
  settings: gear(12, 12, 10, 7.2, 9, 3),
  chart: '<rect x="3" y="12" width="4" height="9" rx=".8" opacity=".6"/><rect x="10" y="6" width="4" height="15" rx=".8"/><rect x="17" y="3" width="4" height="18" rx=".8" opacity=".6"/>',
  sound: '<path d="M3 9h4.2L12.5 4v16l-5.3-5H3z"/><path d="M15.6 8.6a4.8 4.8 0 0 1 0 6.8M18.4 5.8a8.8 8.8 0 0 1 0 12.4" ' + S + ' stroke-width="1.9"/>',
  mute: '<path d="M3 9h4.2L12.5 4v16l-5.3-5H3z"/><path d="M15.5 9l6 6m0-6-6 6" ' + S + ' stroke-width="2"/>',
  save: '<path d="M4 3h12.8L21 7.2V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><rect x="7" y="3" width="9" height="5.5" rx=".5" ' + CUT + '/>'
    + '<rect x="6.5" y="12.5" width="11" height="6.5" rx=".8" fill="#fff" fill-opacity=".7"/>',
  upload: '<path d="M12 2.5l6 6.2h-3.8v6.8H9.8V8.7H6z"/><path d="M3 15v4.5A1.5 1.5 0 0 0 4.5 21h15a1.5 1.5 0 0 0 1.5-1.5V15h-2.4v3.6H5.4V15z" opacity=".6"/>',
  download: '<path d="M12 15.5l-6-6.2h3.8V2.5h4.4v6.8H18z"/><path d="M3 15v4.5A1.5 1.5 0 0 0 4.5 21h15a1.5 1.5 0 0 0 1.5-1.5V15h-2.4v3.6H5.4V15z" opacity=".6"/>',
  plus: '<path d="M10.8 4h2.4v6.8H20v2.4h-6.8V20h-2.4v-6.8H4v-2.4h6.8z"/>',
  up: '<path d="M12 2.6 3.6 11.2h5.2v10.2h6.4V11.2h5.2z"/>',
  trash: '<path d="M9 2.5h6l.8 1.8H20v2.4H4V4.3h4.2z" opacity=".6"/><path d="M5.5 8h13l-1.1 12.4a1.8 1.8 0 0 1-1.8 1.6H8.4a1.8 1.8 0 0 1-1.8-1.6z"/>',
  skull: '<path fill-rule="evenodd" d="M12 2.2c5 0 8.8 3.6 8.8 8.3 0 2.7-1.3 4.6-3.2 5.8v3.4a2 2 0 0 1-2 2H8.4a2 2 0 0 1-2-2v-3.4c-1.9-1.2-3.2-3.1-3.2-5.8 0-4.7 3.8-8.3 8.8-8.3zM8.4 9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2zm7.2 0a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2zM12 13.6l-1.4 2.6h2.8z"/>',
  pick: '<path d="M2.8 8.4C6.6 4.2 12.2 2.6 17.6 4.4l1.3-1.3 2 2-1.3 1.3c1.7 5.3.1 10.9-4.1 14.7.9-4.6.2-8.8-2-11.9-3-2.3-7.1-2.9-10.7-.8z"/>'
    + '<path d="M13.4 8.9l1.6 1.6-9.8 9.8a1.1 1.1 0 0 1-1.6-1.6z" opacity=".6"/>',
  target: '<path fill-rule="evenodd" d="M12 2.2a9.8 9.8 0 1 1 0 19.6 9.8 9.8 0 0 1 0-19.6zm0 3a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6zm0 3a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6z"/><circle cx="12" cy="12" r="1.5"/>',
  gift: '<rect x="3.5" y="11" width="17" height="10.5" rx="1" opacity=".6"/><rect x="2.5" y="7.4" width="19" height="4" rx="1"/>'
    + '<rect x="10.8" y="7.4" width="2.4" height="14.1" ' + CUT + '/><path d="M12 7.4C10.5 4.2 7.6 3.4 6.8 5c-.7 1.5 1.5 2.4 5.2 2.4zm0 0c1.5-3.2 4.4-4 5.2-2.4.7 1.5-1.5 2.4-5.2 2.4z"/>',
  sun: '<circle cx="12" cy="12" r="4.6"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3M4.8 4.8l2.1 2.1M17.1 17.1l2.1 2.1M4.8 19.2l2.1-2.1M17.1 6.9l2.1-2.1" ' + S + ' stroke-width="1.9"/>',
  moon: '<path d="M14.5 2.6A9.5 9.5 0 1 0 21.4 15 7.6 7.6 0 0 1 14.5 2.6z"/>',
  ruler: '<g transform="rotate(-45 12 12)"><rect x="1.5" y="8.5" width="21" height="7" rx="1"/>'
    + '<path d="M5 8.5v3M8.5 8.5v2M12 8.5v3M15.5 8.5v2M19 8.5v3" stroke="#000" stroke-opacity=".5" stroke-width="1.2"/></g>',
  walker: '<circle cx="13.4" cy="3.8" r="2.2"/><path d="M11.6 7.2l3 .8 1.4 3.6 2.6 1.2-.8 1.7-3.3-1.5-.8-1.9-1.1 4 2.6 3.1V22h-2.1v-3.3l-2.6-2.9-1 3.9L7 22l-1.8-.9 2.3-3.7 1.6-6.3-1.6.8-1.2 2.6-1.8-.8 1.6-3.4z"/>',
  question: '<path fill-rule="evenodd" d="M12 2.2a9.8 9.8 0 1 1 0 19.6 9.8 9.8 0 0 1 0-19.6zm.1 4.3c-2.3 0-3.9 1.3-4.1 3.4h2.3c.1-.9.8-1.4 1.7-1.4 1 0 1.7.6 1.7 1.4 0 .8-.4 1.2-1.4 1.8-1.2.7-1.6 1.5-1.5 2.9v.5h2.2v-.4c0-.8.3-1.2 1.4-1.8 1.2-.7 1.9-1.6 1.9-3 0-2-1.7-3.4-4.2-3.4zm-1.3 10v2.3h2.4v-2.3z"/>',
  vault: '<path fill-rule="evenodd" d="M12 1.8a10.2 10.2 0 1 1 0 20.4 10.2 10.2 0 0 1 0-20.4zm0 3.2a7 7 0 1 0 0 14 7 7 0 0 0 0-14z"/>'
    + '<circle cx="12" cy="12" r="2.2"/><path d="M12 6.5v11M6.5 12h11M8.1 8.1l7.8 7.8M15.9 8.1l-7.8 7.8" stroke="currentColor" stroke-width="1.5" opacity=".6"/>',
  door: '<path d="M5 2.5h11.5a1 1 0 0 1 1 1v17.5H5z" opacity=".6"/><path d="M5 2.5l8.5 2v17.6L5 21z"/><circle cx="11.6" cy="12.6" r="1" ' + CUT + '/><rect x="3" y="20.5" width="18" height="1.8" rx=".6"/>',
  info: '<path fill-rule="evenodd" d="M12 2.2a9.8 9.8 0 1 1 0 19.6 9.8 9.8 0 0 1 0-19.6zM10.8 10h2.4v7.5h-2.4zm0-3.8h2.4v2.4h-2.4z"/>',
  bell: '<path d="M12 2.5a1.6 1.6 0 0 1 1.6 1.6v.5a6.2 6.2 0 0 1 4.6 6v4.4l2.1 2.6v1H3.7v-1l2.1-2.6v-4.4a6.2 6.2 0 0 1 4.6-6v-.5A1.6 1.6 0 0 1 12 2.5z"/><path d="M9.6 20.2h4.8a2.4 2.4 0 0 1-4.8 0z" opacity=".6"/>',
  signal: '<circle cx="12" cy="17" r="2.3"/><path d="M7.8 12.8a6 6 0 0 1 8.4 0M4.9 9.9a10 10 0 0 1 14.2 0M2 7a14 14 0 0 1 20 0" ' + S + ' stroke-width="2"/>',
  dish: '<path d="M4.2 6.4a9.4 9.4 0 0 0 13.4 13.4z"/><path d="M10.9 13.1l4.6-4.6" stroke="currentColor" stroke-width="1.7"/><circle cx="16.6" cy="7.4" r="1.9"/>'
    + '<path d="M6 21.5h7l-2-4.2H8z" opacity=".6"/><path d="M17.6 2.6a4 4 0 0 1 3.8 3.8" ' + S + ' stroke-width="1.6" opacity=".6"/>',
  backpack: '<path d="M8.6 5V3.6A1.6 1.6 0 0 1 10.2 2h3.6a1.6 1.6 0 0 1 1.6 1.6V5" ' + S + ' stroke-width="1.8"/>'
    + '<path d="M7 5h10a3 3 0 0 1 3 3v12a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 20V8a3 3 0 0 1 3-3z"/>'
    + '<rect x="7.5" y="13" width="9" height="6" rx="1" ' + CUT + '/><rect x="7" y="9.5" width="10" height="1.6" rx=".8" opacity=".6"/>',
  bandage: '<g transform="rotate(-45 12 12)"><rect x="2" y="8" width="20" height="8" rx="4"/><rect x="8.5" y="8" width="7" height="8" ' + CUT + '/></g>',
  cart: '<path d="M1.8 3.5h3.4l2.5 11.2h11.2l2.3-8.3H6.3" ' + S + ' stroke-width="1.9"/><path d="M7 6.4h14.2l-2.3 8.3H8.8z" opacity=".6"/>'
    + '<circle cx="9.5" cy="19" r="1.8"/><circle cx="17" cy="19" r="1.8"/>',
  chat: '<path d="M3.5 3h11a1.5 1.5 0 0 1 1.5 1.5v6.6a1.5 1.5 0 0 1-1.5 1.5H8.8L5 15.6v-3H3.5A1.5 1.5 0 0 1 2 11.1V4.5A1.5 1.5 0 0 1 3.5 3z"/>'
    + '<path d="M18 8h2.5A1.5 1.5 0 0 1 22 9.5v6.6a1.5 1.5 0 0 1-1.5 1.5H19v3l-3.8-3h-4.7A1.5 1.5 0 0 1 9 16.1V14h5.5A3.5 3.5 0 0 0 18 10.5z" opacity=".6"/>',
  thermometer: '<path fill-rule="evenodd" d="M12 1.8a3 3 0 0 1 3 3v8.8a5 5 0 1 1-6 0V4.8a3 3 0 0 1 3-3zm-1 4v9.2a2.6 2.6 0 1 0 2 0V5.8z"/><circle cx="12" cy="17.6" r="1.8"/>',
  hourglass: '<rect x="4.5" y="2" width="15" height="2.2" rx=".8"/><rect x="4.5" y="19.8" width="15" height="2.2" rx=".8"/>'
    + '<path d="M6.5 4.2h11c0 4-2.4 6-4.4 7.8 2 1.8 4.4 3.8 4.4 7.8h-11c0-4 2.4-6 4.4-7.8-2-1.8-4.4-3.8-4.4-7.8z" opacity=".6"/>'
    + '<path d="M8.6 19c.4-2.2 2-3.3 3.4-4.4 1.4 1.1 3 2.2 3.4 4.4zM9.2 7.2h5.6c-.6 1.3-1.6 2.2-2.8 3.1-1.2-.9-2.2-1.8-2.8-3.1z"/>',
  recycle: '<path d="M9.4 3.6 7.1 7.5l-1.7-1L4 11.3l4.8-.6-1.5-.9 2.2-3.9 2 3.5 2.6-1.5-2.6-4.4c-.5-.8-1.7-.8-2.1.1z"/>'
    + '<path d="M20.8 14.5l-2.2-3.8 1.7-1-3.6-3.4.7 4.8 1.5-.9 2.2 3.9h-4v3h5.2c1 0 1.6-1.1 1.1-1.9z" opacity=".6"/>'
    + '<path d="M7 20h4.5v2l4-3.8-4-3.8v2H7l-2-3.5-2.6 1.5 2.5 4.4c.5.8 1.3 1.2 2.1 1.2z"/>',
  tent: '<path d="M12 3.6 2 20.5h20z" opacity=".6"/><path d="M12 9.5l-4.6 11h9.2z"/><path d="M12 3.6 10.6 1.8M12 3.6l1.4-1.8" stroke="currentColor" stroke-width="1.4"/>',
  medal: '<path d="M7 2h4l2 5.5-3.2 2.4zM17 2h-4l-1.4 3.8 2.6 4.1z" opacity=".6"/><circle cx="12" cy="15" r="6.4"/>'
    + '<path d="M12 11.2l1.1 2.3 2.5.3-1.8 1.7.5 2.5-2.3-1.2-2.3 1.2.5-2.5-1.8-1.7 2.5-.3z" ' + CUT + '/>',
  books: '<rect x="3" y="3.5" width="4" height="17" rx=".8"/><rect x="7.6" y="5.5" width="4" height="15" rx=".8" opacity=".6"/>'
    + '<path d="M12.6 6.9l3.7-1.5 5.3 13.4-3.7 1.5z"/><rect x="2" y="20.4" width="20" height="1.6" rx=".6" opacity=".6"/>',
  satellite: '<rect x="9.2" y="9.2" width="5.6" height="5.6" rx=".8" transform="rotate(45 12 12)"/>'
    + '<path d="M2.6 8.6l3.6-3.6 4 4-3.6 3.6zM13.8 18l3.6-3.6 4 4-3.6 3.6z" opacity=".6"/><path d="M15 9l3-3M16.5 5a2.5 2.5 0 0 1 2.5 2.5" ' + S + ' stroke-width="1.5"/>',
  rocket: '<path d="M14.4 3.2c3-1.2 5.6-1 6.4-.2.8.8 1 3.4-.2 6.4-1.1 2.8-3.8 5.6-7.2 7.6l-6.2-6.2c2-3.4 4.4-6.4 7.2-7.6z"/><circle cx="16.2" cy="7.8" r="1.9" ' + CUT + '/>'
    + '<path d="M7.2 10.8 3 10.4l3.4-3.4 4.4.4zM13.2 16.8l.4 4.4 3.4-3.4-.4-4.2z" opacity=".6"/><path d="M6.3 15.2c-1.6.4-2.6 2.2-2.8 5.3 3.1-.2 4.9-1.2 5.3-2.8z"/>',
  sparkle: '<path d="M12 1.8c.8 4.8 2.2 6.4 7 7.2-4.8.8-6.2 2.4-7 7.2-.8-4.8-2.2-6.4-7-7.2 4.8-.8 6.2-2.4 7-7.2z"/>'
    + '<path d="M18.5 14.5c.4 2.2 1 2.9 3.2 3.3-2.2.4-2.8 1.1-3.2 3.3-.4-2.2-1-2.9-3.2-3.3 2.2-.4 2.8-1.1 3.2-3.3z" opacity=".6"/>',
  clover: '<circle cx="8.3" cy="8.3" r="4.2"/><circle cx="15.7" cy="8.3" r="4.2" opacity=".6"/><circle cx="8.3" cy="15.7" r="4.2" opacity=".6"/>'
    + '<circle cx="15.7" cy="15.7" r="4.2"/><path d="M12 12c1.8 3 4 6 7.5 9" ' + S + ' stroke-width="1.6"/>',
  refresh: '<path d="M19.4 9.2A8 8 0 0 0 5 7.4" ' + S + ' stroke-width="2.2"/><path d="M20.5 3.2v7h-7z"/>'
    + '<path d="M4.6 14.8A8 8 0 0 0 19 16.6" ' + S + ' stroke-width="2.2" opacity=".6"/><path d="M3.5 20.8v-7h7z" opacity=".6"/>',
  crown: '<path d="M2.5 7.5l5 4.2L12 4.5l4.5 7.2 5-4.2-2 11.5h-15z"/><rect x="4.5" y="19.6" width="15" height="2" rx=".8" opacity=".6"/>',
  compound: '<rect x="2" y="6" width="9.4" height="12" rx="1.2"/><rect x="12.6" y="6" width="9.4" height="12" rx="1.2" opacity=".6"/>'
    + '<path d="M9 12h6" stroke="currentColor" stroke-width="2.4"/>',
  cap: '<path d="M12 4 1.5 9 12 14l10.5-5z"/><path d="M6 11.5v4.3c1.6 1.6 3.6 2.4 6 2.4s4.4-.8 6-2.4v-4.3L12 14.4z" opacity=".6"/>'
    + '<path d="M21 9.6v5.6" stroke="currentColor" stroke-width="1.4"/>',
  wheat: '<path d="M12 22V8" stroke="currentColor" stroke-width="1.6"/>'
    + '<path d="M12 8.6c-2.2-.4-3.2-2-3.2-4.2 2.2.4 3.2 2 3.2 4.2zm0 0c2.2-.4 3.2-2 3.2-4.2-2.2.4-3.2 2-3.2 4.2zM12 13c-2.2-.4-3.2-2-3.2-4.2 2.2.4 3.2 2 3.2 4.2zm0 0c2.2-.4 3.2-2 3.2-4.2-2.2.4-3.2 2-3.2 4.2zM12 17.4c-2.2-.4-3.2-2-3.2-4.2 2.2.4 3.2 2 3.2 4.2zm0 0c2.2-.4 3.2-2 3.2-4.2-2.2.4-3.2 2-3.2 4.2z"/>'
    + '<path d="M12 4.4c-.4-1.2 0-2 .6-2.6.4.8.4 1.8-.6 2.6z" opacity=".6"/>',
  battery: '<rect x="2" y="6.5" width="17.5" height="11" rx="1.8" opacity=".6"/><rect x="19.5" y="9.5" width="2.5" height="5" rx=".8"/>'
    + '<rect x="4" y="8.5" width="4" height="7" rx=".6"/><rect x="9" y="8.5" width="4" height="7" rx=".6"/>',
  plug: '<path d="M8 2.5v5M16 2.5v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M5 7.5h14v3.2a7 7 0 0 1-5.6 6.9V22h-2.8v-4.4A7 7 0 0 1 5 10.7z"/>',
  car: '<path d="M5.2 7.8 7 4.2A2 2 0 0 1 8.8 3h6.4A2 2 0 0 1 17 4.2l1.8 3.6" ' + S + ' stroke-width="1.9"/>'
    + '<rect x="2" y="7.8" width="20" height="9" rx="2.2"/><circle cx="6.6" cy="12.2" r="1.5" ' + CUT + '/><circle cx="17.4" cy="12.2" r="1.5" ' + CUT + '/>'
    + '<rect x="3.5" y="16.8" width="4" height="3.5" rx="1" opacity=".6"/><rect x="16.5" y="16.8" width="4" height="3.5" rx="1" opacity=".6"/>',
  gasmask: '<path d="M12 2.6c4.6 0 8 3.4 8 8 0 3.1-1.6 5.6-4 7v.4a4 4 0 0 1-8 0v-.4c-2.4-1.4-4-3.9-4-7 0-4.6 3.4-8 8-8z"/>'
    + '<circle cx="8.6" cy="9.6" r="2.4" ' + CUT + '/><circle cx="15.4" cy="9.6" r="2.4" ' + CUT + '/><circle cx="12" cy="17.8" r="2.4" opacity=".6"/>',
  eye: '<path fill-rule="evenodd" d="M12 5c5 0 8.6 3.6 10.2 7-1.6 3.4-5.2 7-10.2 7S3.4 15.4 1.8 12C3.4 8.6 7 5 12 5zm0 3.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z"/><circle cx="12" cy="12" r="1.7"/>',
  flag: '<rect x="4" y="2.5" width="2.2" height="19.5" rx=".8"/><path d="M6.2 3.5c3-1.4 5.6 1.4 8.6 0s4.8-.6 5.4 0v9c-.6-.6-2.4-1.4-5.4 0s-5.6-1.4-8.6 0z" opacity=".6"/>',
  rad: TREFOIL,
  fire: '<path d="M12 2c.6 3.3 5.8 5.8 5.8 11.3A5.8 5.8 0 0 1 12 19.1a5.8 5.8 0 0 1-5.8-5.8c0-2.6 1.3-4.6 2.6-5.8 0 1.9.8 3.1 2 3.7C10.3 8.5 10.6 4.6 12 2z"/>'
    + '<path d="M12 22a3.8 3.8 0 0 1-3.8-3.8c0-2.1 1.7-3 2.6-4.9.6 1.3 1.6 1.6 2.3 1.2 1.6 1.2 2.7 2.3 2.7 3.7A3.8 3.8 0 0 1 12 22z" opacity=".6"/>',
  bug: '<ellipse cx="12" cy="13.6" rx="5" ry="7"/><circle cx="12" cy="5.4" r="2.6" opacity=".6"/>'
    + '<path d="M7 10 3 8M7 14H2.5M7.4 17.6 3.6 20.6M17 10l4-2M17 14h4.5M16.6 17.6l3.8 3M10.4 3.4 9 1.5M13.6 3.4 15 1.5" ' + S + ' stroke-width="1.5"/>',
  baby: '<circle cx="12" cy="9.5" r="6.6"/><circle cx="9.6" cy="9.4" r="1.1" ' + CUT + '/><circle cx="14.4" cy="9.4" r="1.1" ' + CUT + '/>'
    + '<path d="M10 12.8a2.4 2.4 0 0 0 4 0" stroke="#000" stroke-opacity=".5" stroke-width="1.2" fill="none" stroke-linecap="round"/>'
    + '<path d="M12 2.9c.6-1.2 1.8-1.3 2.4-.6" ' + S + ' stroke-width="1.3"/><path d="M6 21c.7-3 3.2-4.6 6-4.6s5.3 1.6 6 4.6z" opacity=".6"/>',
  rings: '<circle cx="8.8" cy="13.8" r="5.6" ' + S + ' stroke-width="2.1"/><circle cx="15.2" cy="13.8" r="5.6" ' + S + ' stroke-width="2.1" opacity=".6"/>'
    + '<path d="M15.2 3.2l1.6 1.8-1.6 1.8-1.6-1.8z"/>',
  // [Long game] Tier-2 goods: a gear (components) and a stack of cast ingots (alloys).
  components: '<path d="M10.6 2.5h2.8l.5 2.4a7.6 7.6 0 0 1 1.9.8l2-1.4 2 2-1.4 2a7.6 7.6 0 0 1 .8 1.9l2.4.5v2.8l-2.4.5a7.6 7.6 0 0 1-.8 1.9l1.4 2-2 2-2-1.4a7.6 7.6 0 0 1-1.9.8l-.5 2.4h-2.8l-.5-2.4a7.6 7.6 0 0 1-1.9-.8l-2 1.4-2-2 1.4-2a7.6 7.6 0 0 1-.8-1.9L2.5 13.4v-2.8l2.4-.5a7.6 7.6 0 0 1 .8-1.9l-1.4-2 2-2 2 1.4a7.6 7.6 0 0 1 1.9-.8z"/><circle cx="12" cy="12" r="3.2" ' + CUT + '/>',
  alloys: '<path d="M3 17.5 5.2 12.5h6.6l2.2 5z"/><path d="M10 17.5l2.2-5h6.6L21 17.5z" opacity=".6"/><path d="M6.6 11.5 8.8 6.5h6.4l2.2 5z"/><rect x="2.5" y="18" width="19" height="2.2" rx=".6" opacity=".45"/>',
  // [P2] Winter: a six-armed snowflake.
  snow: '<path d="M11 2h2v4.3l2.2-1.3 1 1.7L13 9v2.3l2-1.1 2.2-3.8 1.7 1-1.3 2.3 2.2-1.3 1 1.7-2.2 1.3 2.6 0v2l-4.3 0-2.2 1.3 2 1.1v.1l3.8 2.2-1 1.7-2.3-1.3 1.3 2.3-1.7 1-2.2-3.8-2-1.1V15l3.2 2.3-1 1.7-2.2-1.3V22h-2v-4.3l-2.2 1.3-1-1.7L11 15v-2.3l-2 1.1-2.2 3.8-1.7-1 1.3-2.3-2.2 1.3-1-1.7L5.4 12.9 2.8 12.9v-2l4.3 0 2.2-1.3-2-1.1-3.8-2.2 1-1.7 2.3 1.3-1.3-2.3 1.7-1L9.4 7.4l2 1.1V6.3L8.2 4 9.2 2.3l1.8 1.1z"/>',
  // Decision Inbox: a tray with a card dropping in.
  inbox: '<path d="M3 13.5 5.6 5.2A1.5 1.5 0 0 1 7 4.2h10a1.5 1.5 0 0 1 1.4 1L21 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z" opacity=".6"/>'
    + '<path d="M3 13.5h5.2l1.3 2.6h5l1.3-2.6H21V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z"/><rect x="8" y="6.5" width="8" height="1.8" rx=".6"/><rect x="8" y="9.6" width="8" height="1.8" rx=".6"/>',
  journal: '<rect x="4" y="2.5" width="15" height="19" rx="1.5"/><rect x="4" y="2.5" width="3" height="19" rx="1" opacity=".6"/>'
    + '<path d="M9.5 7.5h6.5M9.5 11h6.5M9.5 14.5h4" stroke="#000" stroke-opacity=".5" stroke-width="1.4" stroke-linecap="round"/><path d="M19 5h1.5v3H19z" opacity=".6"/>',
  tape: '<rect x="2" y="5" width="20" height="14" rx="2"/><rect x="5" y="8" width="14" height="5.4" rx="2.7" ' + CUT + '/>'
    + '<circle cx="8.2" cy="10.7" r="1.7"/><circle cx="15.8" cy="10.7" r="1.7"/><path d="M6.5 19l1.6-3.4h7.8l1.6 3.4z" opacity=".6"/>',
  note: '<path d="M4.5 2.5h10.5l4.5 4.5v14.5h-15z"/><path d="M15 2.5V7h4.5z" opacity=".6"/>'
    + '<path d="M7.5 11h9M7.5 14h9M7.5 17h6" stroke="#000" stroke-opacity=".5" stroke-width="1.3" stroke-linecap="round"/>',
  broom: '<path d="M19.8 2.6l1.6 1.6-7.2 7.2-1.6-1.6z" opacity=".6"/><path d="M11.4 9.6l3 3c.8.8.8 2 0 2.8l-1 1c-1.6 1.6-4.4 3.9-9.4 5.2l-.6-.6 3-3.4-3.4 3-.6-.6c1.3-5 3.6-7.8 5.2-9.4l1-1c.8-.8 2-.8 2.8 0z"/>',
  flashlight: '<path d="M3 9.5h8l2.5-2.5h7v10h-7L11 14.5H3z" opacity=".6"/><rect x="2" y="9.5" width="10" height="5" rx="1"/>'
    + '<path d="M21.5 7v10" stroke="currentColor" stroke-width="2"/>',
  wave: '<path d="M2 9c2.5-2.4 4.5-2.4 7 0s4.5 2.4 7 0 4.5-2.4 6 0M2 15c2.5-2.4 4.5-2.4 7 0s4.5 2.4 7 0 4.5-2.4 6 0" ' + S + ' stroke-width="2.2"/>',
  district: '<rect x="2" y="9" width="6" height="12.5" rx=".8" opacity=".6"/><rect x="9" y="3" width="6" height="18.5" rx=".8"/><rect x="16" y="7" width="6" height="14.5" rx=".8" opacity=".6"/>'
    + '<path d="M10.8 6h2.4M10.8 9.5h2.4M10.8 13h2.4M10.8 16.5h2.4" stroke="#000" stroke-opacity=".5" stroke-width="1.4"/>',
  zoom: '<path fill-rule="evenodd" d="M10 2.5a7.5 7.5 0 0 1 6 12l5.4 5.4-1.6 1.6-5.4-5.4A7.5 7.5 0 1 1 10 2.5zm0 2.6a4.9 4.9 0 1 0 0 9.8 4.9 4.9 0 0 0 0-9.8z"/>',
  arrowLeft: '<path d="M10.5 4.5 3 12l7.5 7.5 1.7-1.7-4.6-4.6H21v-2.4H7.6l4.6-4.6z"/>',
  arrowRight: '<path d="M13.5 4.5 21 12l-7.5 7.5-1.7-1.7 4.6-4.6H3v-2.4h13.4l-4.6-4.6z"/>',
  hand: '<path d="M9 11V4.2a1.6 1.6 0 0 1 3.2 0V10h.4V3.2a1.6 1.6 0 0 1 3.2 0V10h.4V5a1.6 1.6 0 0 1 3.2 0v9.2c0 4.3-3 7.8-7.4 7.8-2.6 0-4.4-1.2-5.8-3.3L3 13.2a1.7 1.7 0 0 1 2.6-2.1L9 14.3z"/>',
} as const;

export type IconName = keyof typeof ICON_SVG;

export function isIcon(name: string): name is IconName {
  return name in ICON_SVG;
}

export function iconSvg(name: IconName, size = 24): string {
  return `<svg class="ic-svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${ICON_SVG[name]}</svg>`;
}

/** A standalone icon element; color comes from CSS (`currentColor`). */
export function icon(name: IconName, className = ''): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `ic ic-${name} ${className}`.trim();
  span.innerHTML = iconSvg(name);
  return span;
}

/** Token for embedding an icon inside a translatable string. */
export function tok(name: IconName): string {
  return `[[${name}]]`;
}

/** Brand colors for resource icons (used by DOM chips and canvas popups). */
export const ICON_COLORS: Partial<Record<IconName, string>> = {
  food: '#e8a24a', water: '#4fb6ff', power: '#ffd23f', materials: '#c98a5a', medicine: '#ff6b6b',
  knowledge: '#b48cff', scrap: '#a7b0ba', blueprints: '#6fa8ff', isotope7: '#8dff5a', credits: '#f0c75e', star: '#ffd23f',
  heart: '#ff5f6d', happy: '#ffd23f', sad: '#8aa0b8', check: '#5ee38a', close: '#ff6b6b', warning: '#ffb547',
  pick: '#d9a441', skull: '#e0e0e0', strength: '#ff8a5a', intelligence: '#ffe27a', agility: '#7ae0ff',
  charisma: '#ff9ad5', endurance: '#9ad08a',
};

const rasterCache = new Map<string, HTMLCanvasElement>();
const pendingRaster = new Map<string, Promise<HTMLCanvasElement>>();

/** Renders an icon to a canvas (for textures in the Pixi scene). */
export function rasterizeIcon(name: IconName, color: string, px = 48): Promise<HTMLCanvasElement> {
  const key = `${name}|${color}|${px}`;
  const done = rasterCache.get(key);
  if (done) return Promise.resolve(done);
  const pending = pendingRaster.get(key);
  if (pending) return pending;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${px}" height="${px}" fill="${color}" color="${color}">${ICON_SVG[name]}</svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const p = img.decode().then(() => {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const ctx = c.getContext('2d')!;
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = px / 16;
    ctx.shadowOffsetY = px / 32;
    ctx.drawImage(img, 0, 0, px, px);
    rasterCache.set(key, c);
    pendingRaster.delete(key);
    return c;
  });
  pendingRaster.set(key, p);
  return p;
}

export function rasterizedIcon(name: IconName, color: string, px = 48): HTMLCanvasElement | null {
  return rasterCache.get(`${name}|${color}|${px}`) ?? null;
}
