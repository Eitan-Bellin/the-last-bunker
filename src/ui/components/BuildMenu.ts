import type { BuildingType, GameState, ResourceType } from '../../core/GameState';
import type { ResourceSystem } from '../../systems/ResourceSystem';
import type { BuildingSystem } from '../../systems/BuildingSystem';
import { i18n } from '../../i18n/I18nManager';
import { BUILDABLE_TYPES, actMult, getDef, roomSlots, type BuildingDef } from '../../data/buildingDefs';
import { BUILD_CATEGORIES, buildCategoryOf, type BuildCategory } from '../../data/buildCategories';
import { allowedFloors, zoneForFloor } from '../../data/zones';
import { actOf } from '../../data/acts';
import { isBuildingUnlocked, unlockingResearch } from '../../systems/ResearchSystem';
import { recommendedRooms } from '../../systems/BuildAdvice';
import { Sheet } from './Sheet';
import { ArtLibrary } from '../../art/ArtLibrary';
import { buildingArtKey } from '../../art/registry';
import { BUILDING_ICONS, RESOURCE_ICONS, el } from '../dom';

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
}

/**
 * [plan4:BL-39] The build menu: category chips, a search field (16px so iOS does not zoom), an "available now" filter, a
 * "recommended now" row and cards (icon, name, what it makes, price with a check or a cross, width dots, and for a locked room the
 * research that opens it). Every tap target is at least 44px; nothing is told by colour alone.
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
  private category: BuildCategory | 'all' = 'all';
  private query = '';
  private onlyAvailable = false;

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
    this.refresh(state);
    this.sheet.show();
  }

  hide(): void {
    this.sheet.hide();
  }

  get isVisible(): boolean {
    return this.sheet.isVisible;
  }

  private entries(state: GameState): Entry[] {
    const out: Entry[] = [];
    for (const type of BUILDABLE_TYPES) {
      const def = getDef(type);
      if (!def) continue;
      const cost = this.buildings.getBuildCost(type, state);
      const unlocked = isBuildingUnlocked(state, type);
      out.push({
        type, def, cost, unlocked,
        affordable: unlocked && this.resources.canAfford(state, cost),
        count: state.buildings.filter(b => b.type === type).length,
        max: def.maxCopies ?? Infinity,
      });
    }
    return out;
  }

  /** Whether the room could be placed somewhere right now (unlocked, under its limit, a free spot). */
  private placeable(state: GameState, e: Entry): boolean {
    if (!e.unlocked || e.count >= e.max) return false;
    for (const f of allowedFloors(e.type, state.currentFloors)) if (this.buildings.findFreeSpot(e.type, f, state)) return true;
    return false;
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
    const present = BUILD_CATEGORIES.filter(c => all.some(e => buildCategoryOf(e.type) === c.id));
    if (this.category !== 'all' && !present.some(c => c.id === this.category)) this.category = 'all';

    // A search looks through every category (a typed word means the player knows what they want).
    const shown = all.filter(e => (this.category === 'all' || !!this.query || buildCategoryOf(e.type) === this.category)
      && this.matches(e, locale) && (!this.onlyAvailable || (e.affordable && this.placeable(state, e))));
    const recs = this.query || this.onlyAvailable ? [] : recommendedRooms(state, t => {
      const e = all.find(x => x.type === t);
      return !!e && this.placeable(state, e);
    });

    const sig = [
      locale, this.category, this.query, this.onlyAvailable, actOf(state).id,
      shown.map(e => `${e.type}:${e.unlocked}:${e.affordable}:${e.count}:${JSON.stringify(e.cost)}`).join('|'),
      recs.map(r => `${r.type}:${r.why}`).join(','),
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

  private renderChips(present: { id: BuildCategory; icon: string }[], all: Entry[]): void {
    const chip = (id: BuildCategory | 'all', icon: string, label: string, n: number) => {
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
      chip('all', '[[build]]', i18n.t('build.cat.all'), all.length),
      ...present.map(c => chip(c.id, c.icon, i18n.t(`build.cat.${c.id}`), all.filter(e => buildCategoryOf(e.type) === c.id).length)),
    );
  }

  private renderRecommended(state: GameState, recs: { type: BuildingType; why: string }[], all: Entry[]): void {
    this.rec.style.display = recs.length ? '' : 'none';
    if (!recs.length) return;
    const locale = i18n.currentLocale;
    const row = el('div', 'bm-rec-row');
    for (const r of recs) {
      const e = all.find(x => x.type === r.type)!;
      const b = el('button', `bm-rec-chip${e.affordable ? '' : ' disabled'}`);
      b.type = 'button';
      b.append(
        el('span', 'bm-rec-ic', BUILDING_ICONS[r.type] ?? ''),
        el('span', 'bm-rec-text', ''),
      );
      const text = b.querySelector('.bm-rec-text') as HTMLElement;
      text.append(el('span', 'bm-rec-name', e.def.name[locale] ?? e.def.name.en), el('span', 'bm-rec-why', i18n.t(r.why)));
      b.addEventListener('click', () => this.pick(state, e));
      row.appendChild(b);
    }
    this.rec.replaceChildren(el('div', 'bm-rec-title', `[[star]] ${i18n.t('build.recommended')}`), row);
  }

  private pick(state: GameState, e: Entry): void {
    if (!e.unlocked || e.count >= e.max || !this.resources.canAfford(state, e.cost)) return;
    this.hide();
    this.onSelectBuilding?.(e.type);
  }

  private renderList(state: GameState, shown: Entry[], locale: string): void {
    this.list.replaceChildren();
    if (!shown.length) {
      this.list.appendChild(el('div', 'bm-empty', i18n.t('build.noMatch')));
      return;
    }
    // Rooms you can build come first, locked ones after; inside each group the menu's own order holds.
    const ordered = [...shown.filter(e => e.unlocked), ...shown.filter(e => !e.unlocked)];
    for (const e of ordered) this.list.appendChild(this.card(state, e, locale));
  }

  /** The room's main results as short chips with an icon (a number alone would not say what it is). */
  private outputs(def: BuildingDef): string[] {
    const out: string[] = [];
    for (const [r, p] of Object.entries(def.production ?? {})) out.push(`${RESOURCE_ICONS[r] ?? ''} \u2066${i18n.formatRate(p.base)}/s\u2069`); // LRI..PDI: "+0.9/s" keeps its order in right-to-left text
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

  /** Price chips: a check or a cross says whether you have enough (colour is only a second cue). */
  private costChips(state: GameState, cost: Record<string, number>): HTMLElement {
    const row = el('div', 'cost-row bm-cost');
    for (const [r, amount] of Object.entries(cost)) {
      const have = state.resources[r as ResourceType]?.amount ?? 0;
      const ok = have >= amount;
      const chip = el('span', `cost-chip ${ok ? 'affordable' : 'expensive'}`, `${ok ? '[[check]]' : '[[close]]'} ${RESOURCE_ICONS[r] ?? ''} ${i18n.formatCompact(amount)}`);
      chip.setAttribute('aria-label', i18n.t('build.haveNeed', { res: i18n.t(`resources.${r}`), have: Math.floor(have), need: amount }));
      row.appendChild(chip);
    }
    return row;
  }

  private card(state: GameState, e: Entry, locale: string): HTMLElement {
    const { def, type } = e;
    const full = e.count >= e.max;
    const card = el('div', `bm-card${e.unlocked ? '' : ' locked'}${e.unlocked && (!e.affordable || full) ? ' disabled' : ''}`);
    // [plan4:AC-8] A room you can build is a button named by the room; a locked one holds its own "what opens it" button, so it is a group
    // (a button inside a button is invalid), and a card that cannot be picked now says so (the grey look was the only sign).
    const pickable = e.unlocked && !full && e.affordable;
    card.setAttribute('role', e.unlocked ? 'button' : 'group');
    if (e.unlocked) card.tabIndex = 0;
    if (e.unlocked && !pickable) card.setAttribute('aria-disabled', 'true');

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
    if (def.powerConsumption > 0) meta.appendChild(el('span', '', `[[power]] −${def.powerConsumption}`));
    if (def.maxWorkers > 0) meta.appendChild(el('span', '', `[[worker]] ${def.maxWorkers}`));
    if (def.maxCopies !== undefined) meta.appendChild(el('span', '', `[[district]] ${i18n.t('build.copies', { n: e.count, max: def.maxCopies })}`));
    info.appendChild(meta);

    if (e.unlocked) {
      info.appendChild(this.costChips(state, e.cost));
      if (def.priceByAct) {
        const m = actMult(actOf(state).id);
        if (m > 1) info.appendChild(el('div', 'bp-hint bm-act', `[[flag]] ${i18n.t('build.actPrice', { n: m })}`));
      }
      if (full) info.appendChild(el('div', 'bp-hint bm-limit', `[[lock]] ${i18n.t('build.copiesFull', { n: e.count, max: e.max })}`));
    } else {
      info.appendChild(this.lockLine(type, def, locale));
    }

    card.append(thumb, info);
    const activate = () => this.pick(state, e);
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        activate();
      }
    });
    return card;
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
    const btn = el('button', 'bm-unlock', `[[lock]] ${text} [[research]]`);
    btn.type = 'button';
    btn.setAttribute('aria-label', `${i18n.t('build.openResearch')}: ${def.name[locale] ?? def.name.en}`);
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.hide();
      this.onOpenResearch?.();
    });
    return btn;
  }
}
