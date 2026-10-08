import type { GameState, ResourceType, SurvivorStats } from '../core/GameState';
import { haptic } from '../utils/haptics';
import { i18n } from '../i18n/I18nManager';
import { iconSvg, isIcon, tok, type IconName } from './icons';
import { uiSound } from '../audio/uiSound';

/** Icon tokens for resources; embed them in any UI string. */
export const RESOURCE_ICONS: Record<string, string> = {
  food: tok('food'),
  water: tok('water'),
  power: tok('power'),
  materials: tok('materials'),
  medicine: tok('medicine'),
  knowledge: tok('knowledge'),
  scrap: tok('scrap'),
  blueprints: tok('blueprints'),
  isotope7: tok('isotope7'),
  credits: tok('credits'),
  components: tok('components'),
  alloys: tok('alloys'),
  data: tok('chart'),
  influence: tok('crown'),
  seedCores: tok('clover'),
};

export const STAT_ICONS: Record<keyof SurvivorStats, string> = {
  strength: tok('strength'),
  intelligence: tok('intelligence'),
  agility: tok('agility'),
  charisma: tok('charisma'),
  endurance: tok('endurance'),
};

export const BUILDING_ICONS: Record<string, string> = {
  quarters: tok('quarters'),
  generator: tok('generator'),
  farm: tok('farm'),
  waterPump: tok('waterPump'),
  workshop: tok('workshop'),
  medbay: tok('medbay'),
  canteen: tok('canteen'),
  storage: tok('storage'),
  elevator: tok('elevator'),
  laboratory: tok('laboratory'),
  radioTower: tok('radioTower'),
  hydroponics: tok('hydroponics'),
  waterPurifier: tok('waterPurifier'),
  trainingRoom: tok('trainingRoom'),
  armory: tok('armory'),
  reactor: tok('reactor'),
  // [plan4:BL-9..14,19,33] the first eight new rooms
  batteryBank: tok('batteryBank'),
  commons: tok('commons'),
  library: tok('library'),
  recycler: tok('recycler'),
  condenser: tok('condenser'),
  mushroomFarm: tok('mushroomFarm'),
  gatePost: tok('gatePost'),
  barracks: tok('barracks'),
  // [plan4:BL-15..32] wave 2 rooms
  quarantineWard: tok('quarantineWard'),
  solarArray: tok('solarArray'),
  windTurbine: tok('windTurbine'),
  watchtower: tok('watchtower'),
  garage: tok('garage'),
  decon: tok('decon'),
  aquaculture: tok('aquaculture'),
  market: tok('market'),
  nursery: tok('nursery'),
  school: tok('school'),
  bathhouse: tok('bathhouse'),
  memorialHall: tok('memorialHall'),
  // [plan4:BL-24,25,34..38] wave 3
  geothermal: tok('geothermal'),
  oldVault: tok('oldVault'),
  componentsPlant: tok('componentsPlant'),
  alloyFoundry: tok('alloyFoundry'),
  dataCenter: tok('dataCenter'),
  forum: tok('forum'),
  seedLab: tok('seedLab'),
};
// [plan4:ST-16] stand-in icons for the surface row's rooms until Rooms-Data's own arrive (??= keeps theirs)
BUILDING_ICONS.solarArray ??= tok('sun');
BUILDING_ICONS.windTurbine ??= tok('wave');
BUILDING_ICONS.watchtower ??= tok('eye');

const TOKEN = /\[\[([a-zA-Z0-9]+)\]\]/g;

/** A signed number ("+2.9", "−1", "+10%", "+1.2K") that does not continue a word or a range like "3-5". */
const SIGNED = /[+\-−–]\s?\d[\d.,]*(?:%|[KMB](?!\p{L}))?/gu;

/**
 * In right-to-left text a leading sign is a neutral character and drifts to the far side ("2.9+", "1–").
 * Wrapping signed numbers in a left-to-right isolate (LRI … PDI) keeps "+2.9" intact while the
 * number still takes its natural place in the Hebrew sentence.
 */
export function bidiNumbers(text: string): string {
  if (document.documentElement.dir !== 'rtl' || !/[+\-−–]\s?\d/.test(text)) return text;
  // A sign glued to a letter or digit ("A-5", "3-5") is not a signed number. (No regex lookbehind: older iPhones cannot even parse one.)
  return text.replace(SIGNED, (m, offset: number) => (/[\p{L}\p{N}]/u.test(text[offset - 1] ?? '') ? m : `⁦${m}⁩`));
}

/** Fills a node with text in which [[icon]] tokens become inline SVG icons. */
export function setRich(node: HTMLElement, text: string): void {
  if (!text.includes('[[')) {
    node.textContent = bidiNumbers(text);
    return;
  }
  node.textContent = '';
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) node.appendChild(document.createTextNode(bidiNumbers(text.slice(last, m.index))));
    const name = m[1];
    if (isIcon(name)) {
      const span = document.createElement('span');
      span.className = `ic ic-${name}`;
      span.innerHTML = iconSvg(name as IconName);
      node.appendChild(span);
    } else {
      node.appendChild(document.createTextNode(m[0]));
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) node.appendChild(document.createTextNode(bidiNumbers(text.slice(last))));
}

/** Strips icon tokens (for places that can only show plain text). */
export function plain(text: string): string {
  return text.replace(TOKEN, '').replace(/\s{2,}/g, ' ').trim();
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) setRich(node, text);
  return node;
}

/**
 * [plan4:BL-25,34..38] A production rate for the panels: per second as usual, but a trickle (the pre-war vault's blueprints, a forum's influence:
 * under 0.01 a second) is shown per hour, since "+0.00 /s" says nothing.
 */
export function rateText(perSecond: number): string {
  if (perSecond > 0 && perSecond < 0.005) return `${i18n.formatRate(perSecond * 3600)} ${i18n.t('resources.perHour')}`;
  return `${i18n.formatRate(perSecond)} ${i18n.t('resources.perSecond')}`;
}

export function costRow(state: GameState, cost: Record<string, number>): HTMLDivElement {
  const row = el('div', 'cost-row');
  for (const [r, amount] of Object.entries(cost)) {
    const have = state.resources[r as ResourceType]?.amount ?? 0;
    row.appendChild(el('span', `cost-chip ${have >= amount ? 'affordable' : 'expensive'}`, `${RESOURCE_ICONS[r] ?? ''} ${amount}`));
  }
  return row;
}

export function bar(pct: number, className = ''): HTMLDivElement {
  const track = el('div', `bar-track ${className}`);
  const fill = el('div', 'bar-fill');
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  track.appendChild(fill);
  return track;
}

export function setBar(track: HTMLElement | null | undefined, pct: number): void {
  const fill = track?.firstElementChild as HTMLElement | null;
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

export function button(label: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el('button', `btn ${className}`, label);
  b.disabled = disabled;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.disabled) {
      haptic('error');
      return;
    }
    haptic('tap');
    if (/\btab(-btn)?\b/.test(b.className)) uiSound('tab');
    onClick();
  });
  return b;
}

export function localizedTrait(trait: string, gender?: 'm' | 'f'): string {
  return i18n.t(`traits.${trait}`, gender ? { g: gender } : undefined);
}
