import type { BuildingType, GameState, ResourceType, Ruin } from '../../core/GameState';
import type { ResourceSystem } from '../../systems/ResourceSystem';
import type { BuildingSystem } from '../../systems/BuildingSystem';
import { i18n } from '../../i18n/I18nManager';
import { BUILDABLE_TYPES, actMult, getDef, roomFloors, roomSlots, type BuildingDef } from '../../data/buildingDefs';
import { BUILD_CATEGORIES, buildCategoryOf, type BuildCategory } from '../../data/buildCategories';
import { allowedFloors, zoneForFloor } from '../../data/zones';
import { actOf } from '../../data/acts';
import { isBuildingUnlocked, unlockingResearch } from '../../systems/ResearchSystem';
import { floorRangesLabel } from '../../systems/placementRank';
import { Sheet } from './Sheet';
import { ArtLibrary } from '../../art/ArtLibrary';
import { buildingArtKey } from '../../art/registry';
import { BUILDING_ICONS, RESOURCE_ICONS, el, rateText } from '../dom';
import { describeMissing, missingList } from '../missing';
import { floorTag } from '../floorTag';
import { BATTERY_ROOMS, BED_ROOMS, KID_ROOMS, MORALE_ROOMS, NEED_ROOMS } from '../../systems/BuildAdvice'; // [ux-redesign w2fix] one source for the lists
import { fmtCost, fmtDuration } from '../format';
import { kButton } from '../kit';
import { haptic } from '../../utils/haptics';
import { uiSound } from '../../audio/uiSound';

/** [ux-wp4] B2: what a price still lacks and roughly when the bunker will have it (the shared helper, src/ui/missing.ts); empty when nothing is. */
export function missingText(state: GameState, cost: Record<string, number>): string {
  return missingList(state, cost).length ? describeMissing(state, cost) : '';
}

/** LRI..PDI: "B2", "B3–B5" or "4m" keep their order inside a Hebrew line. */
const iso = (t: string): string => `\u2066${t}\u2069`;

/**
 * [ux-redesign w2c #2] Where to go when a room has no free spot anywhere it may stand, best first:
 *  - wreck: a wrecked room of this very type (restoring it gives the room back without needing a spot),
 *  - clear: plain rubble whose clearing frees a spot the room fits,
 *  - dig / digging: a new floor would take it (or one is being dug already),
 *  - none: nothing to do now (the words say where the room may stand).
 * A pure reading of the state (findFreeSpot / digBlock on copies): nothing here changes the game.
 */
export type NoSpaceRoute =
  | { kind: 'wreck'; ruin: Ruin }
  | { kind: 'clear'; ruin: Ruin }
  | { kind: 'dig' }
  | { kind: 'digging' }
  | { kind: 'none' };

/** Is there a free spot for `type` on any floor it may stand on (judged against `state`)? */
export function hasFreeSpot(bs: BuildingSystem, state: GameState, type: BuildingType): boolean {
  return allowedFloors(type, state.currentFloors).some(f => !!bs.findFreeSpot(type, f, state));
}

export function noSpaceRoute(bs: BuildingSystem, state: GameState, type: BuildingType): NoSpaceRoute {
  const ruins = state.ruins ?? [];
  const wreck = ruins.find(r => r.restoresTo === type && !r.started) ?? ruins.find(r => r.restoresTo === type);
  if (wreck) return { kind: 'wreck', ruin: wreck };
  const floors = allowedFloors(type, state.currentFloors);
  // A wreck turns into another room and keeps its spot, so only plain rubble frees one. Work already under way first.
  const clearable = ruins.filter(r => !r.restoresTo && floors.includes(r.floor)).sort((a, b) => Number(b.started) - Number(a.started) || a.floor - b.floor);
  for (const r of clearable) {
    const probe: GameState = { ...state, ruins: ruins.filter(x => x.id !== r.id) };
    if (floors.some(f => !!bs.findFreeSpot(type, f, probe))) return { kind: 'clear', ruin: r };
  }
  // Would the next floor take it? (A tall room needs one of its levels on the new floor.)
  const n = state.currentFloors;
  const levels = roomFloors(type);
  if (allowedFloors(type, n + 1).some(f => f <= n && f + levels - 1 >= n)) {
    const block = bs.digBlock(state);
    if (block === null) return { kind: 'dig' };
    if (block === 'digging') return { kind: 'digging' };
  }
  return { kind: 'none' };
}

/** The words of a no-space route ("No space: restore the wrecked Farm on B2 →"). */
export function noSpaceText(state: GameState, type: BuildingType, route: NoSpaceRoute): string {
  const def = getDef(type);
  const name = def?.name[i18n.currentLocale] ?? def?.name.en ?? type;
  switch (route.kind) {
    case 'wreck': return i18n.t(route.ruin.started ? 'ux2c.noSpace.wreckBusy' : 'ux2c.noSpace.wreck', { name, floor: iso(floorTag(route.ruin.floor)) });
    case 'clear': return i18n.t('ux2c.noSpace.clear', { floor: iso(floorTag(route.ruin.floor)) });
    case 'dig': return i18n.t('ux2c.noSpace.dig');
    case 'digging': return i18n.t('ux2c.noSpace.digging');
    default: return i18n.t('ux2c.noSpace.none', { floors: iso(floorRangesLabel(allowedFloors(type, state.currentFloors))) });
  }
}

/**
 * [ux-redesign w2c] Price chips that say what is missing: a check or a cross (a11y.css draws it, colour-vision aware), the price, and on a price the bunker
 * cannot pay yet how much is short ("20 · 8 short"). Shared by the build cards, the placement bar and the wrecked-room sheet.
 */
export function costChips(state: GameState, cost: Record<string, number>, className = ''): HTMLElement {
  const row = el('div', `cost-row ux2c-cost${className ? ` ${className}` : ''}`);
  for (const [r, amount] of Object.entries(cost)) {
    const have = state.resources[r as ResourceType]?.amount ?? 0;
    const ok = have >= amount;
    const chip = el('span', `cost-chip ${ok ? 'affordable' : 'expensive'}`, `${RESOURCE_ICONS[r] ?? ''} ${fmtCost(amount)}`);
    if (!ok) chip.appendChild(el('span', 'ux2c-short', i18n.t('ux2c.short', { n: fmtCost(amount - have) })));
    chip.setAttribute('aria-label', i18n.t('build.haveNeed', { res: i18n.t(`resources.${r}`), have: Math.floor(have), need: amount }));
    row.appendChild(chip);
  }
  return row;
}

/** One "Recommended now" entry: a room and why (i18n key + params). `wreck` = no free spot, but restoring that wreck gives the room. */
interface Rec {
  type: BuildingType;
  why: string;
  params?: Record<string, string>;
  wreck?: Ruin;
}

const net = (state: GameState, r: ResourceType): number => (state.resources[r]?.productionRate ?? 0) - (state.resources[r]?.consumptionRate ?? 0);

/** What one card needs to know about a room right now. */
interface Entry {
  type: BuildingType;
  def: BuildingDef;
  cost: Record<string, number>;
  unlocked: boolean;
  affordable: boolean;
  /** Built so far / the type's copy limit (Infinity when it has none). */
  count: number;
  max: number;
  /** [w2c #2] A free spot exists on a floor the room may stand on. */
  placeable: boolean;
  /** [w2c #2] Unlocked, under its limit, but no free spot: where to go instead. */
  route: NoSpaceRoute | null;
}

/**
 * [plan4:BL-39] The build menu: category chips, a search field (16px so iOS does not zoom), an "available now" filter, a
 * "recommended now" row and cards (icon, name, what it makes, price with a check or a cross, width dots, and for a locked room the
 * research that opens it). Every tap target is at least 44px; nothing is told by colour alone.
 * [ux-redesign w2c] A room with no free spot never pretends it can be built: its card says where the space is (restore the wreck, clear the
 * rubble, dig a floor) and a tap goes there (through onSelectBuilding: WorldController.startPlacement routes a room without a spot).
 */
export class BuildMenu {
  private sheet = new Sheet('build-sheet', 'build');
  private signature = '';

  onSelectBuilding: ((type: BuildingType) => void) | null = null;
  /** Opens the research panel (set by the app) when the player taps what unlocks a locked room. */
  onOpenResearch: (() => void) | null = null;

  private resources: ResourceSystem;
  private buildings: BuildingSystem;

  // The toolbar is built once so typing in the search field is not interrupted by the periodic refresh.
  private root = el('div', 'bm');
  private search = document.createElement('input');
  private toggle = el('button', 'bm-toggle');
  private chips = el('div', 'bm-chips');
  private rec = el('div', 'bm-rec');
  private list = el('div', 'bm-list');
  /** [ux-wp4] B2/P7: the menu opens on "Can build now" (every unlocked room, any category). */
  private category: BuildCategory | 'all' | 'now' = 'now';
  /** [ux-wp4] B2/P7: the locked rooms sit folded under one "Locked (N)" row. */
  private lockedOpen = false;
  private query = '';
  private onlyAvailable = false;
  /** [w2c] Free-spot answers per room type, kept while the bunker's layout is the same (the refresh runs twice a second). */
  private spotKey = '';
  private spotCache = new Map<BuildingType, boolean>();

  constructor(resources: ResourceSystem, buildings: BuildingSystem) {
    this.resources = resources;
    this.buildings = buildings;

    this.search.type = 'search';
    this.search.className = 'bm-search';
    this.search.autocomplete = 'off';
    this.search.enterKeyHint = 'search';
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase();
      this.redraw();
    });
    this.toggle.type = 'button';
    this.toggle.addEventListener('click', () => {
      this.onlyAvailable = !this.onlyAvailable;
      this.redraw();
    });
    const tools = el('div', 'bm-tools');
    tools.append(this.search, this.toggle);
    this.root.append(tools, this.chips, this.rec, this.list);
    this.sheet.body.replaceChildren(this.root);
  }

  private lastState: GameState | null = null;

  /** Re-renders after a filter changed (the signature is cleared first). */
  private redraw(): void {
    this.signature = '';
    if (this.lastState) this.refresh(this.lastState);
  }

  show(state: GameState): void {
    this.sheet.setTitle(`[[build]] ${i18n.t('build.title')}`);
    this.signature = '';
    this.category = 'now';
    this.lockedOpen = false;
    this.refresh(state);
    this.sheet.show();
  }

  hide(): void {
    this.sheet.hide();
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  /** Whether `type` has a free spot now (cached until a room, ruin, floor or wing changes). */
  private freeSpot(state: GameState, type: BuildingType): boolean {
    const key = [
      state.currentFloors, JSON.stringify(state.layout ?? null),
      state.buildings.map(b => `${b.type}@${b.position.floor}:${b.position.x}`).join(','),
      (state.ruins ?? []).map(r => r.id).join(','),
      (state.storyFlags ?? []).length,
    ].join('|');
    if (key !== this.spotKey) {
      this.spotKey = key;
      this.spotCache.clear();
    }
    let v = this.spotCache.get(type);
    if (v === undefined) {
      v = hasFreeSpot(this.buildings, state, type);
      this.spotCache.set(type, v);
    }
    return v;
  }

  private entries(state: GameState): Entry[] {
    const out: Entry[] = [];
    for (const type of BUILDABLE_TYPES) {
      const def = getDef(type);
      if (!def) continue;
      const cost = this.buildings.getBuildCost(type, state);
      const unlocked = isBuildingUnlocked(state, type);
      const count = state.buildings.filter(b => b.type === type).length;
      const max = def.maxCopies ?? Infinity;
      const open = unlocked && count < max;
      const placeable = open && this.freeSpot(state, type);
      out.push({
        type, def, cost, unlocked, count, max, placeable,
        affordable: unlocked && this.resources.canAfford(state, cost),
        route: open && !placeable ? noSpaceRoute(this.buildings, state, type) : null,
      });
    }
    return out;
  }

  private matches(e: Entry, locale: string): boolean {
    if (!this.query) return true;
    const hay = [e.def.name[locale], e.def.name.en, e.def.name.he, e.def.description[locale]].join(' ').toLowerCase();
    return hay.includes(this.query);
  }

  refresh(state: GameState): void {
    this.lastState = state;
    const locale = i18n.currentLocale;
    const all = this.entries(state);
    // Only categories that have a buildable room get a chip.
    const present = BUILD_CATEGORIES.filter(c => all.some(e => buildCategoryOf(e.type) === c.id && (c.id !== 'act' || e.unlocked))); // plan4:BL-34..38 the Act chip shows once an Act room is open
    if (this.category !== 'all' && this.category !== 'now' && !present.some(c => c.id === this.category)) this.category = 'now';

    // A search looks through every category (a typed word means the player knows what they want).
    const shown = all.filter(e => (this.category === 'all' || this.category === 'now' || !!this.query || buildCategoryOf(e.type) === this.category)
      && this.matches(e, locale) && (!this.onlyAvailable || (e.affordable && e.placeable)));
    const recs = this.query || this.onlyAvailable ? [] : this.recommendations(state, all);

    const routeSig = (e: Entry) => (e.route ? `${e.route.kind}${'ruin' in e.route ? `:${e.route.ruin.id}:${e.route.ruin.started}` : ''}` : '');
    const sig = [
      locale, this.category, this.query, this.onlyAvailable, actOf(state).id, this.lockedOpen,
      shown.map(e => `${e.type}:${e.unlocked}:${e.affordable}:${e.count}:${e.placeable}:${routeSig(e)}:${JSON.stringify(e.cost)}`).join('|'),
      recs.map(r => `${r.type}:${r.why}:${r.params?.time ?? ''}:${r.wreck?.id ?? ''}`).join(','),
      present.map(c => c.id).join(','),
    ].join('#');
    if (sig === this.signature) return;
    this.signature = sig;

    this.search.placeholder = i18n.t('build.searchPh');
    this.search.setAttribute('aria-label', i18n.t('build.search'));
    this.toggle.className = `bm-toggle${this.onlyAvailable ? ' on' : ''}`;
    this.toggle.setAttribute('aria-pressed', String(this.onlyAvailable));
    this.toggle.replaceChildren();
    this.toggle.append(el('span', 'bm-toggle-ic', this.onlyAvailable ? '[[check]]' : '[[build]]'), el('span', '', i18n.t('build.availableNow')));

    this.renderChips(present, all);
    this.renderRecommended(state, recs, all);
    this.renderList(state, shown, locale);
  }

  /**
   * [w2c #3] "Recommended now", by real need: first the stores that run out (food, water, power, soonest to empty first, from the current
   * rates), then beds, then a low battery, then spirits and children. Only rooms with a free spot, or whose wreck can be restored.
   */
  private recommendations(state: GameState, all: Entry[], max = 3): Rec[] {
    const out: Rec[] = [];
    const add = (why: string, types: BuildingType[], params?: Record<string, string>) => {
      for (const type of types) {
        if (out.length >= max) return;
        if (out.some(t => t.type === type)) continue;
        const e = all.find(x => x.type === type);
        if (!e) continue;
        if (e.placeable) out.push({ type, why, params });
        else if (e.route?.kind === 'wreck' && !e.route.ruin.started) out.push({ type, why, params, wreck: e.route.ruin });
      }
    };
    const needs = (['food', 'water', 'power'] as const).map(r => {
      const res = state.resources[r];
      const n = net(state, r);
      const dark = r === 'power' && (state.powerRatio ?? 1) < 0.99;
      const empty = dark ? 0 : n < 0 && res ? res.amount / -n : Infinity;
      return { r, n, empty, short: dark || n < (r === 'power' ? 0.5 : 0.2) };
    }).filter(x => x.short).sort((a, b) => a.empty - b.empty || a.n - b.n);
    for (const x of needs) {
      if (x.empty === 0) add('build.rec.power', NEED_ROOMS.power);
      else if (isFinite(x.empty)) add(`ux2c.rec.${x.r}`, NEED_ROOMS[x.r], { time: iso(fmtDuration(x.empty)) });
      else add(`build.rec.${x.r}`, NEED_ROOMS[x.r]);
    }
    if (state.survivors.length >= state.maxPopulation - 1) add('build.rec.beds', BED_ROOMS);
    const p = state.resources.power;
    if (p && p.cap > 0 && p.amount < p.cap * 0.25 && net(state, 'power') >= 0.5) add('build.rec.battery', BATTERY_ROOMS);
    if (state.survivors.length >= 4) {
      const mood = state.survivors.reduce((s, x) => s + x.happiness, 0) / state.survivors.length;
      if (mood < 55) add('build.rec.morale', MORALE_ROOMS);
    }
    // [plan4:BL-26/30] Children need a place of their own: a nursery first, then a school.
    if (state.survivors.some(x => x.child) && !state.buildings.some(b => b.type === 'nursery')) add('build.rec.kids', KID_ROOMS.first);
    else if (state.survivors.filter(x => x.child).length >= 3 && !state.buildings.some(b => b.type === 'school')) add('build.rec.kids', KID_ROOMS.then);
    return out;
  }

  private renderChips(present: { id: BuildCategory; icon: string }[], all: Entry[]): void {
    const chip = (id: BuildCategory | 'all' | 'now', icon: string, label: string, n: number) => {
      const b = el('button', `bm-chip${this.category === id ? ' active' : ''}`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(this.category === id));
      b.append(el('span', 'bm-chip-ic', icon), el('span', 'bm-chip-label', label), el('span', 'bm-chip-n', String(n)));
      b.addEventListener('click', () => {
        this.category = id;
        this.redraw();
      });
      return b;
    };
    this.chips.replaceChildren(
      // [ux-redesign w2fix B8] The count is the rooms with a free spot right now (a "No space" card is open but cannot be built yet).
      chip('now', '[[check]]', i18n.t('wp4.canBuild'), all.filter(e => e.placeable).length),
      chip('all', '[[build]]', i18n.t('build.cat.all'), all.length),
      ...present.map(c => chip(c.id, c.icon, i18n.t(`build.cat.${c.id}`), all.filter(e => buildCategoryOf(e.type) === c.id).length)),
    );
  }

  private renderRecommended(state: GameState, recs: Rec[], all: Entry[]): void {
    this.rec.style.display = recs.length ? '' : 'none';
    if (!recs.length) return;
    const locale = i18n.currentLocale;
    const row = el('div', 'bm-rec-row');
    for (const r of recs) {
      const e = all.find(x => x.type === r.type)!;
      const name = e.def.name[locale] ?? e.def.name.en;
      // A wreck to restore names itself ("Wrecked Farm"); its price is the ruin's, shown on the ruin's sheet.
      const title = r.wreck ? i18n.t('ruin.wreckOf', { name }) : name;
      const text = el('span', 'bm-rec-text');
      text.append(el('span', 'bm-rec-name', title), el('span', 'bm-rec-why', i18n.t(r.why, r.params)));
      const body = el('span', 'bm-rec-body');
      body.append(el('span', 'bm-rec-ic', r.wreck ? '[[workshop]]' : BUILDING_ICONS[r.type] ?? ''), text);
      const b = kButton({
        variant: 'secondary',
        className: 'bm-rec-chip',
        detail: body,
        ariaLabel: `${title}: ${i18n.t(r.why, r.params)}`,
        disabledReason: r.wreck ? null : missingText(state, e.cost) || null,
        onPress: () => this.pick(this.lastState ?? state, all.find(x => x.type === r.type) ?? e),
      });
      row.appendChild(b);
    }
    this.rec.replaceChildren(el('div', 'bm-rec-title', `[[star]] ${i18n.t('build.recommended')}`), row);
  }

  private pick(state: GameState, e: Entry, card?: HTMLElement): void {
    if (!e.unlocked) return;
    // [w2c #2] No free spot: go where the space is (WorldController routes a room without a spot), or say why there is none.
    if (e.route) {
      if (e.route.kind === 'none') { this.refuse(card, noSpaceText(state, e.type, e.route)); return; }
      this.hide();
      this.onSelectBuilding?.(e.type);
      return;
    }
    // [ux-wp4] B2: a card that cannot be picked says why (what is missing and when it will be there), with a buzz, instead of doing nothing.
    const why = e.count >= e.max ? i18n.t('build.copiesFull', { n: e.count, max: e.max }) : missingText(state, e.cost);
    if (why) { this.refuse(card, why); return; }
    this.hide();
    this.onSelectBuilding?.(e.type);
  }

  /** A buzz and the reason under the card's info. */
  private refuse(card: HTMLElement | undefined, why: string): void {
    haptic('error');
    uiSound('error', 0.6);
    if (!card) return;
    let line = card.querySelector<HTMLElement>('.bm-why');
    if (!line) {
      line = el('div', 'bm-why');
      line.setAttribute('role', 'status');
      (card.querySelector('.bm-info') ?? card).appendChild(line);
    }
    line.textContent = '';
    line.append(el('span', '', `[[warning]] ${why}`));
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
  }

  private renderList(state: GameState, shown: Entry[], locale: string): void {
    this.list.replaceChildren();
    if (!shown.length) {
      this.list.appendChild(el('div', 'bm-empty', i18n.t('build.noMatch')));
      return;
    }
    // Rooms you can build come first; [ux-wp4] B2/P7 the locked ones fold under one "Locked (N)" row (open while searching).
    // [w2c] Among the open ones, the rooms with a free spot before those that need space first (same order otherwise).
    const open = shown.filter(e => e.unlocked).sort((a, b) => Number(!!b.placeable) - Number(!!a.placeable));
    const locked = shown.filter(e => !e.unlocked);
    for (const e of open) this.list.appendChild(this.card(state, e, locale));
    if (!open.length && !locked.length) return;
    if (!open.length) this.list.appendChild(el('div', 'bm-empty', i18n.t('build.noMatch')));
    if (!locked.length) return;
    const expanded = this.lockedOpen || !!this.query;
    const fold = el('button', `bm-locked${expanded ? ' open' : ''}`);
    fold.type = 'button';
    fold.setAttribute('aria-expanded', String(expanded));
    fold.append(el('span', '', `[[lock]] ${i18n.t('wp4.locked', { n: locked.length })}`), el('span', 'bm-locked-arrow', expanded ? '▴' : '▾'));
    fold.addEventListener('click', () => {
      uiSound('click');
      this.lockedOpen = !expanded;
      this.redraw();
    });
    this.list.appendChild(fold);
    if (expanded) for (const e of locked) this.list.appendChild(this.card(state, e, locale));
  }

  /** The room's main results as short chips with an icon (a number alone would not say what it is). */
  private outputs(def: BuildingDef): string[] {
    const out: string[] = [];
    for (const [r, p] of Object.entries(def.production ?? {})) out.push(`${RESOURCE_ICONS[r] ?? ''} \u2066${p.base < 0.005 ? rateText(p.base) : `${i18n.formatRate(p.base)}/s`}\u2069`); // plan4:BL-25 a trickle shows per hour; // LRI..PDI: "+0.9/s" keeps its order in right-to-left text
    const fx = def.effects;
    if (fx?.morale) out.push(`[[happy]] +${fx.morale.base}${fx.moraleKind && fx.moraleKind !== 'base' ? ` ${i18n.t(`morale.channel.${fx.moraleKind}`)}` : ''}`);
    if (fx?.maxPopulation) out.push(`[[quarters]] +${fx.maxPopulation.base}`);
    if (fx?.defense) out.push(`[[endurance]] +${fx.defense.base}`);
    for (const [r, v] of Object.entries(fx?.storageCap ?? {})) if (def.maxWorkers === 0 || r === 'power' || r === 'knowledge') out.push(`[[storage]] ${RESOURCE_ICONS[r] ?? ''} +${v}`);
    // [plan4:BL-15..32] the wave 2 effects (icon + number, same as the chips above)
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    if (fx?.childCapacity) out.push(`[[baby]] ${fx.childCapacity.base}`);
    if (fx?.quarantine) out.push(`[[medbay]] ${fx.quarantine.base}`);
    if (fx?.earlyWarning) out.push(`[[signal]] +${fx.earlyWarning.base}s`);
    if (fx?.expeditionTeams) out.push(`[[backpack]] +1`);
    if (fx?.cargo) out.push(`[[cart]] +${pct(fx.cargo.base)}`);
    if (fx?.returnSafety) out.push(`[[backpack]] \u2212${pct(fx.returnSafety.base)}`);
    if (fx?.hygiene) out.push(`[[bandage]] \u2212${pct(fx.hygiene.base)}`);
    if (fx?.mourning) out.push(`[[heart]] \u2212${pct(fx.mourning.base)}`);
    return out.slice(0, 4);
  }

  private card(state: GameState, e: Entry, locale: string): HTMLElement {
    const { def, type } = e;
    const full = e.count >= e.max;
    const noSpace = !!e.route;
    const card = el('div', `bm-card${e.unlocked ? '' : ' locked'}${e.unlocked && (!e.affordable || full || noSpace) ? ' disabled' : ''}${noSpace ? ' no-space' : ''}`);
    // [plan4:AC-8] A room you can build is a button named by the room; a locked one holds its own "what opens it" button, so it is a group
    // (a button inside a button is invalid), and a card that cannot be picked now says so (the grey look was the only sign).
    // [w2c #2] A card with no free spot holds its own "where the space is" button: a group as well.
    const pickable = e.unlocked && !full && e.affordable && !noSpace;
    card.setAttribute('role', e.unlocked && !noSpace ? 'button' : 'group');
    if (e.unlocked && !noSpace) card.tabIndex = 0;
    if (e.unlocked && !noSpace && !pickable) card.setAttribute('aria-disabled', 'true');

    const thumb = el('div', 'build-icon build-thumb bm-thumb');
    const art = buildingArtKey(type, 0);
    if (art) {
      thumb.style.backgroundImage = `url(${ArtLibrary.url(art)})`;
      thumb.appendChild(el('span', 'build-badge', BUILDING_ICONS[type] ?? ''));
    } else {
      // A room with no painting yet: its own colour and a large icon.
      thumb.style.background = def.color;
      thumb.appendChild(el('span', 'bm-thumb-ic', BUILDING_ICONS[type] ?? ''));
    }

    const info = el('div', 'build-info bm-info');
    const head = el('div', 'bm-head');
    const nameEl = el('div', 'build-item-name', def.name[locale] ?? def.name.en);
    nameEl.id = `bm-name-${type}`; // [plan4:AC-8] the card's accessible name
    card.setAttribute('aria-labelledby', nameEl.id);
    head.appendChild(nameEl);
    const slots = roomSlots(type);
    const dots = el('span', 'bm-dots');
    dots.setAttribute('role', 'img');
    dots.setAttribute('aria-label', i18n.t('build.width', { n: slots }));
    for (let i = 0; i < slots; i++) dots.appendChild(el('span', 'bm-dot'));
    head.appendChild(dots);
    info.appendChild(head);
    const descEl = el('div', 'build-item-desc', def.description[locale] ?? def.description.en);
    descEl.id = `bm-desc-${type}`;
    card.setAttribute('aria-describedby', descEl.id);
    info.appendChild(descEl);

    const outs = this.outputs(def);
    if (outs.length) {
      const row = el('div', 'bm-outs');
      for (const o of outs) row.appendChild(el('span', 'bm-out', o));
      info.appendChild(row);
    }

    const meta = el('div', 'build-meta');
    const place = def.place?.floors;
    if (place === 'deep') meta.appendChild(el('span', 'zone-chip', `[[pick]] ${i18n.t('build.deepOnly')}`));
    else if (place === 'surface') meta.appendChild(el('span', 'zone-chip', `[[surface]] ${i18n.t('build.surfaceOnly')}`));
    else if (place === 'entranceOrSurface') meta.appendChild(el('span', 'zone-chip', `[[surface]] ${i18n.t('build.entranceOrSurface')}`)); // plan4:ST-16
    else {
      const floors = allowedFloors(type);
      if (floors.length === 1) {
        const zone = zoneForFloor(floors[0]);
        meta.appendChild(el('span', 'zone-chip', place === 'entrance' ? `${zone.icon} ${i18n.t('build.entranceOnly')}` : `${zone.icon} B${zone.floor + 1} ${zone.name[locale] ?? zone.name.en}`));
      }
    }
    meta.appendChild(el('span', '', `[[clock]] ${i18n.formatDuration(def.constructionTime)}`));
    if (def.powerConsumption > 0) meta.appendChild(el('span', '', `[[power]] \u2212${def.powerConsumption}`));
    if (def.maxWorkers > 0) meta.appendChild(el('span', '', `[[worker]] ${def.maxWorkers}`));
    if (def.maxCopies !== undefined) meta.appendChild(el('span', '', `[[district]] ${i18n.t('build.copies', { n: e.count, max: def.maxCopies })}`));
    info.appendChild(meta);

    if (e.unlocked) {
      info.appendChild(costChips(state, e.cost, 'bm-cost'));
      if (def.priceByAct) {
        const m = actMult(actOf(state).id);
        if (m > 1) info.appendChild(el('div', 'bp-hint bm-act', `[[flag]] ${i18n.t('build.actPrice', { n: m })}`));
      }
      if (full) info.appendChild(el('div', 'bp-hint bm-limit', `[[lock]] ${i18n.t('build.copiesFull', { n: e.count, max: e.max })}`));
      else if (e.route) info.appendChild(this.noSpaceLine(state, e));
    } else {
      info.appendChild(this.lockLine(type, def, locale));
    }

    card.append(thumb, info);
    if (!e.unlocked || noSpace) return card;
    const activate = () => this.pick(this.lastState ?? state, e, card);
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        activate();
      }
    });
    return card;
  }

  /** [w2c #2] The card's one action when the room has no free spot: where the space is, or (nowhere) a plain line saying so. */
  private noSpaceLine(state: GameState, e: Entry): HTMLElement {
    const route = e.route!;
    const text = noSpaceText(state, e.type, route);
    if (route.kind === 'none') return el('div', 'bp-hint bm-nospace', `[[lock]] ${text}`);
    return kButton({
      variant: 'primary',
      className: 'btn-primary bm-route',
      icon: route.kind === 'wreck' ? 'workshop' : route.kind === 'clear' ? 'broom' : 'pick',
      label: text,
      sound: 'click',
      onPress: () => this.pick(this.lastState ?? state, e),
    });
  }

  /** The line on a locked card: what opens it, and a tap that goes to the research panel. */
  private lockLine(type: BuildingType, def: BuildingDef, locale: string): HTMLElement {
    const req = unlockingResearch(type);
    if (!req) {
      // No research: the room opens by a story event.
      return el('div', 'bp-hint bm-lock', `[[lock]] ${i18n.t('build.needsFlag')}`);
    }
    const name = req.name[locale] ?? req.name.en;
    const text = req.act && req.act > 1 ? i18n.t('build.unlocksWithAct', { name, n: req.act }) : i18n.t('build.unlocksWith', { name });
    return kButton({
      variant: 'tertiary',
      className: 'btn-ghost bm-unlock',
      icon: 'lock',
      label: `${text} [[research]]`,
      ariaLabel: `${i18n.t('build.openResearch')}: ${def.name[locale] ?? def.name.en}`,
      onPress: () => {
        this.hide();
        this.onOpenResearch?.();
      },
    });
  }
}
