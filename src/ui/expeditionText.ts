import type { JournalEntry } from '../core/GameState';
import { i18n } from '../i18n/I18nManager';
import { expeditionEvent } from '../data/expeditionEvents';
import { POIS } from '../data/surface';
import { el } from './dom';

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
  if (typeof vars.name === 'string') vars.name = localName(vars.name);
  if (typeof vars.poi === 'string') vars.poi = POIS[vars.poi]?.name[locale] ?? vars.poi;
  const icon: Record<string, string> = {
    depart: '[[door]]', arrive: '[[flag]]', trouble: '[[warning]]', poi: '[[star]]', recruit: '[[person]]', injury: '[[bandage]]', return: '[[vault]]',
  };
  return { icon: icon[e.key] ?? '[[map]]', text: i18n.t(`exp.j.${e.key}`, vars) };
}

/** The whole travel log as a timeline element. */
export function journalTimeline(entries: JournalEntry[], place: string, localName: (n: string) => string): HTMLElement {
  const list = el('div', 'exp-journal');
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
