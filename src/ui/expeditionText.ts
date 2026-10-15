import type { JournalEntry } from '../core/GameState';
import { i18n } from '../i18n/I18nManager';
import { expeditionEvent } from '../data/expeditionEvents';
import { POIS } from '../data/surface';
import { genderOfName } from '../data/portraits';
import { el } from './dom';

/** [ux-wp5 C11] Log lines with three wordings, and how many lines from the road there are. */
const VOICED = new Set(['depart', 'arrive', 'trouble', 'return']);
const ROAD_LINES = 5;

function clock(t: number): string {
  const m = Math.floor(t / 60), s = Math.round(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** One travel-log line in the reader's language. */
export function journalLine(e: JournalEntry, place: string, localName: (n: string) => string): { icon: string; text: string } {
  const locale = i18n.currentLocale;
  if (e.key.startsWith('event:')) {
    const ev = expeditionEvent(e.key.slice(6));
    return { icon: ev ? `[[${ev.icon}]]` : '[[signal]]', text: ev ? `${ev.title[locale]}: ${ev.text[locale]}` : '' };
  }
  if (e.key.startsWith('choice:')) {
    const [, id, key] = e.key.split(':');
    const opt = expeditionEvent(id)?.options.find(o => o.key === key);
    const auto = e.vars?.auto ? ` ${i18n.t('exp.auto')}` : '';
    return { icon: '[[chat]]', text: opt ? `«${opt.label[locale]}» · ${opt.result[locale]}${auto}` : '' };
  }
  const vars: Record<string, string | number> = { place, ...(e.vars ?? {}) };
  if (typeof vars.name === 'string') {
    const g = genderOfName(vars.name);
    vars.name = localName(vars.name);
    if (g) vars.g = g;
  }
  if (typeof vars.poi === 'string') vars.poi = POIS[vars.poi]?.name[locale] ?? vars.poi;
  const icon: Record<string, string> = {
    depart: '[[door]]', arrive: '[[flag]]', trouble: '[[warning]]', poi: '[[star]]', recruit: '[[person]]', injury: '[[bandage]]', return: '[[vault]]', road: '[[walker]]',
  };
  // [ux-wp5 C11] The team's own voice: the common lines come in three wordings, and a line from the road (see journalTimeline).
  if (e.key === 'road') return { icon: icon.road, text: i18n.t(`exp.j.road.${Number(e.vars?.v ?? 0) % ROAD_LINES}`, vars) };
  const v = VOICED.has(e.key) ? Math.round(e.t) % 3 : 0;
  return { icon: icon[e.key] ?? '[[map]]', text: i18n.t(v ? `exp.j.${e.key}.${v}` : `exp.j.${e.key}`, vars) };
}

/** The whole travel log as a timeline element. */
export function journalTimeline(entries: JournalEntry[], place: string, localName: (n: string) => string): HTMLElement {
  const list = el('div', 'exp-journal');
  // [ux-wp5 C11] A line from the road, halfway there (the same one each time this log is opened).
  const dep = entries.find(e => e.key === 'depart');
  const at = entries.find(e => e.key === 'arrive' || e.key === 'trouble');
  if (dep && at && at.t - dep.t > 60) {
    const seed = entries.reduce((a, e) => a + Math.round(e.t), 0);
    const road: JournalEntry = { t: Math.round((dep.t + at.t) / 2), key: 'road', vars: { v: seed % ROAD_LINES } };
    entries = [...entries.slice(0, entries.indexOf(at)), road, ...entries.slice(entries.indexOf(at))];
  }
  for (const e of entries) {
    const { icon, text } = journalLine(e, place, localName);
    if (!text) continue;
    const row = el('div', `exp-entry ${e.key.split(':')[0]}`);
    row.append(el('span', 'exp-time', clock(e.t)), el('span', 'exp-icon', icon), el('span', 'exp-text', text));
    list.appendChild(row);
  }
  return list;
}

/** Painted illustration of a biome (expedition reports and decisions). */
export function biomeImage(biome: string | undefined): HTMLElement | null {
  if (!biome || biome === 'bunker') return null;
  const img = el('img', 'biome-art');
  img.src = `${import.meta.env.BASE_URL}art/biomes/${biome}.webp`;
  img.alt = '';
  return img;
}
