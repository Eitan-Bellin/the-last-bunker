import type { ExplorationHex, GameState } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { fmtDuration, fmtNum, plural } from '../format';
import { BIOMES, MAP_RADIUS, POIS, hexDistance, mapRadiusFor, type BiomeId } from '../../data/surface';
import { RESEARCH } from '../../data/research';
import { MAX_TEAM, maxTeams } from '../../systems/ExplorationSystem';
import { RESOURCE_ICONS, STAT_ICONS, bar, el, setBar, setRich, costRow } from '../dom';
import { flowArrow } from '../rtl';
import { describeMissing } from '../missing';
import { kButton, kEmpty, kRow } from '../kit';
import { uiSound } from '../../audio/uiSound';
import { renderTrade } from './TradePanel'; // [LateGame B2]
import { getPartner } from '../../data/trade';
import { ICON_SVG, isIcon } from '../icons';
import { ensureBiomeTiles, paintWorldMap } from './worldMap'; // plan 2026-10 M6
import { ResearchPanel } from './ResearchPanel';
import '../../styles/surface.css';

const S = 20;
const SQRT3 = Math.sqrt(3);
/** [ux-redesign W2d #9] The smallest on-screen width of one region, in CSS px (a 44 px finger, the audit's minimum). */
const HEX_MIN_PX = 44;
/** [ux-redesign W2d #9] Regions listed before "Show all". */
const REGION_LIST_MAX = 12;

function hexCenter(q: number, r: number): { x: number; y: number } {
  return { x: S * SQRT3 * (q + r / 2), y: S * 1.5 * r };
}

function hexPoints(cx: number, cy: number, size = S - 1): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + size * Math.cos(a)).toFixed(1)},${(cy + size * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** The research that opens the surface (Hazmat Suits): the node its locked state points at. */
const SURFACE_KEY = RESEARCH.find(r => r.effects.some(e => e.type === 'feature' && e.feature === 'surface'));

/**
 * Surface map: pick a region (on the map, or from the list of regions in reach), choose a team, send an expedition.
 * [ux-redesign W2d #15] While the surface is shut it is a small card at the bottom (what opens it, a way there), not a full screen.
 */
export class SurfacePanel {
  private engine: GameEngine;
  private overlay: HTMLDivElement;
  private mapBox: HTMLDivElement;
  private missionsBox: HTMLDivElement;
  private card: HTMLDivElement;
  private selected: { q: number; r: number } | null = null;
  private team = new Set<string>();
  private mapSig = '';
  private cardSig = '';
  private missionSig = '';
  private missionBars = new Map<string, { bar: HTMLElement; time: HTMLElement }>();
  /** Scroll the zoomed map to home on the first draw after opening. */
  private centerPending = false;
  /** The region list shows the nearest REGION_LIST_MAX until "Show all" is pressed (reset on open). */
  private allRegions = false;

  onOpenResearch: (() => void) | null = null;

  constructor(engine: GameEngine) {
    this.engine = engine;
    this.overlay = el('div', 'surface-overlay');
    const header = el('div', 'surface-header');
    const close = kButton({ variant: 'close', icon: 'close', className: 'btn-ghost surface-close', ariaLabel: i18n.t('journal.close'), onPress: () => this.hide() });
    header.append(el('h2', 'sheet-title', `[[surface]] ${i18n.t('surface.title')}`), close);
    // [plan4:AC-8] A dialog with a name; its close button has one too.
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', i18n.t('surface.title'));
    this.missionsBox = el('div', 'surface-missions');
    this.mapBox = el('div', 'surface-map');
    this.mapBox.dir = 'ltr'; // a picture of the ground: west stays west in Hebrew, and the scroll maths stay simple
    this.card = el('div', 'surface-card');
    this.mapBox.addEventListener('click', (e) => {
      const g = (e.target as Element).closest('[data-q]');
      if (!g) return;
      this.select(Number(g.getAttribute('data-q')), Number(g.getAttribute('data-r')));
    });
    // The locked card sits over the bunker: a tap beside it closes it, like a sheet.
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay && this.overlay.classList.contains('is-locked')) this.hide();
    });
    this.overlay.append(header, this.missionsBox, this.mapBox, this.card);
    document.body.appendChild(this.overlay);
  }

  show(): void {
    this.engine.explorationSystem.ensureMap();
    this.mapSig = this.cardSig = this.missionSig = '';
    this.centerPending = true;
    this.allRegions = false;
    this.overlay.classList.add('open');
    this.refresh(this.engine.stateManager.state);
  }

  hide(): void {
    this.overlay.classList.remove('open');
    // The painted terrain is a few MB of canvas: let it go while the map is closed (it is redrawn on the next open).
    const painted = this.mapBox.querySelector<HTMLCanvasElement>('.map-paint');
    if (painted) painted.width = painted.height = 0;
    this.mapSig = '';
  }

  get isVisible(): boolean {
    return this.overlay.classList.contains('open');
  }

  private select(q: number, r: number): void {
    this.selected = { q, r };
    this.team.clear();
    this.mapSig = '';
    this.cardSig = '';
    uiSound('click');
    this.refresh(this.engine.stateManager.state);
    this.card.scrollTop = 0;
  }

  private redraw(): void {
    this.mapSig = this.cardSig = this.missionSig = '';
    this.refresh(this.engine.stateManager.state);
  }

  refresh(state: GameState): void {
    if (!this.engine.explorationSystem.isUnlocked(state)) {
      this.overlay.classList.add('is-locked');
      this.renderLocked(state);
      return;
    }
    if (this.overlay.classList.contains('is-locked')) {
      this.overlay.classList.remove('is-locked');
      this.mapSig = this.cardSig = this.missionSig = '';
    }
    this.renderMap(state);
    this.renderMissions(state);
    this.renderCard(state);
  }

  /** [ux-redesign W2d #15] What opens the surface, how far along it is, and a way there. */
  private renderLocked(state: GameState): void {
    const rs = this.engine.researchSystem;
    const key = SURFACE_KEY;
    const status = key ? rs.status(state, key.id) : 'locked';
    const sig = `locked|${status}|${i18n.currentLocale}|${key ? rs.canStart(state, key.id) : ''}|${Math.floor(state.stats.totalPlayTime / 10)}`;
    if (this.mapSig === sig) return;
    this.mapSig = sig;
    this.missionsBox.replaceChildren();
    this.card.replaceChildren();
    const box = el('div', 'surface-locked');
    const name = key ? key.name[i18n.currentLocale] ?? key.name.en : '';
    box.appendChild(el('div', 'surface-locked__need', `[[lock]] ${i18n.t('ux2d.surface.needs', { name })}`));
    box.appendChild(el('p', 'surface-locked__teaser', i18n.t('ux2d.surface.teaser')));
    if (key && (status === 'active' || status === 'queued')) {
      const node = state.research[key.id];
      const left = status === 'active' && node ? (node.total - node.progress) / rs.speed(state) : rs.etaSeconds(state, key.id);
      box.appendChild(el('div', 'bp-hint', `[[hourglass]] ${i18n.t('ux2d.surface.researching', { t: i18n.formatDuration(left) })}`));
    } else if (key && status === 'available' && !rs.canStart(state, key.id)) {
      box.appendChild(el('div', 'bp-hint', describeMissing(state, key.cost as Record<string, number>)));
    }
    if (key) {
      const label = status === 'active' || status === 'queued' ? i18n.t('ux2d.surface.seeResearch') : i18n.t('ux2d.surface.goResearch', { name });
      box.appendChild(kButton({
        label: `[[research]] ${label} ${flowArrow()}`,
        onPress: () => { ResearchPanel.focusNext(key.id); this.onOpenResearch?.(); },
      }));
    }
    this.mapBox.replaceChildren(box);
  }

  private renderMap(state: GameState): void {
    const sig = [
      state.explorationMap.map(h => `${h.revealed ? 1 : 0}${h.explored ? 1 : 0}${h.poi ?? ''}`).join(''),
      state.activeMissions.map(m => `${m.hexX},${m.hexY}`).join(';'),
      this.selected ? `${this.selected.q},${this.selected.r}` : '',
      JSON.stringify(state.longGame?.world.outposts ?? []), // [P4]
    ].join('|');
    if (sig === this.mapSig) return;
    this.mapSig = sig;

    const radius = Math.max(MAP_RADIUS, mapRadiusFor(state.longGame?.meta.act ?? 1), state.explorationMap.reduce((m, hx) => Math.max(m, hexDistance(hx.x, hx.y)), 0));
    const w = S * SQRT3 * (2 * radius + 1) + 4;
    const h = S * 1.5 * 2 * radius + 2 * S + 4;
    // [ux-redesign W2d #9] Drawn big enough that one region is at least a finger wide; the box scrolls (both ways) around it.
    const minW = Math.ceil(w * HEX_MIN_PX / (S * SQRT3));
    const parts: string[] = [];
    // Plan 2026-10 M6: the terrain is painted on a canvas behind the SVG, which keeps the clicks, icons and rings.
    parts.push(`<div class="map-wrap is-zoomed" style="aspect-ratio:${w.toFixed(1)}/${h.toFixed(1)};width:max(100%, ${minW}px)"><canvas class="map-paint"></canvas><svg viewBox="${-w / 2} ${-h / 2} ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`);
    const targets = new Set(state.activeMissions.map(m => `${m.hexX},${m.hexY}`));

    for (const hex of state.explorationMap) {
      const { x, y } = hexCenter(hex.x, hex.y);
      const sel = this.selected && this.selected.q === hex.x && this.selected.r === hex.y;
      // The colour of a hex comes from the painted terrain behind; the polygon catches taps (the whole hex) and marks the selection.
      const cls = `hex${hex.revealed ? '' : ' fog'}${sel ? ' is-selected' : ''}`;
      const attrs = hex.revealed ? ` data-q="${hex.x}" data-r="${hex.y}" class="${cls}"` : ` class="${cls}"`;
      parts.push(`<g${attrs}><polygon points="${hexPoints(x, y, S)}"/>`);
      let icon = '';
      if (hex.biome === 'bunker') icon = '[[vault]]';
      else if (hex.revealed && hex.poi) icon = POIS[hex.poi]?.icon ?? '';
      else if (!hex.revealed) icon = '';
      else if (!hex.explored) icon = '?';
      const iconName = /^\[\[([a-zA-Z0-9]+)\]\]$/.exec(icon)?.[1];
      if (iconName && isIcon(iconName)) {
        const s = 0.62;
        parts.push(`<g class="hex-icon" transform="translate(${(x - 12 * s).toFixed(1)} ${(y - 12 * s).toFixed(1)}) scale(${s})">${ICON_SVG[iconName]}</g>`);
      } else if (icon) {
        parts.push(`<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" class="hex-q" text-anchor="middle">${icon}</text>`);
      }
      // [P4] An outpost: a flag in the corner (dim while building, red when damaged).
      const op = this.engine.outpostSystem.at(state, hex.x, hex.y);
      if (op) {
        const ocls = op.damaged ? 'outpost-flag damaged' : op.readyAt > (state.longGame?.meta.worldT ?? 0) ? 'outpost-flag building' : 'outpost-flag';
        parts.push(`<g class="${ocls}" transform="translate(${(x + 2).toFixed(1)} ${(y - S * 0.85).toFixed(1)}) scale(0.45)">${ICON_SVG.flag}</g>`);
      }
      if (targets.has(`${hex.x},${hex.y}`)) {
        parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${S * 0.7}" class="mission-ring"/>`);
      }
      parts.push('</g>');
    }
    for (const m of state.activeMissions) {
      const t = hexCenter(m.hexX, m.hexY);
      parts.push(`<line x1="0" y1="0" x2="${t.x.toFixed(1)}" y2="${t.y.toFixed(1)}" class="mission-line"/>`);
    }
    parts.push('</svg></div>');
    const keepX = this.mapBox.scrollLeft, keepY = this.mapBox.scrollTop;
    this.mapBox.innerHTML = parts.join('');
    if (this.centerPending) {
      // Home is the middle of the map: start there.
      this.centerPending = false;
      requestAnimationFrame(() => {
        this.mapBox.scrollLeft = (this.mapBox.scrollWidth - this.mapBox.clientWidth) / 2;
        this.mapBox.scrollTop = (this.mapBox.scrollHeight - this.mapBox.clientHeight) / 2;
      });
    } else {
      this.mapBox.scrollLeft = keepX;
      this.mapBox.scrollTop = keepY;
    }
    const canvas = this.mapBox.querySelector<HTMLCanvasElement>('.map-paint');
    if (canvas) {
      const hexes = state.explorationMap.map(hx => ({ x: hx.x, y: hx.y, biome: hx.biome, revealed: hx.revealed, explored: hx.explored }));
      void ensureBiomeTiles().then(() => {
        if (canvas.isConnected) paintWorldMap(canvas, hexes, w, h, S - 1, hexCenter);
      });
    }
  }

  private renderMissions(state: GameState): void {
    const sig = state.activeMissions.map(m => `${m.id}:${m.waiting ? 1 : 0}`).join(',') + i18n.currentLocale + maxTeams(state) + '|' + (state.rush ?? 0);
    if (sig !== this.missionSig) {
      this.missionSig = sig;
      this.missionBars.clear();
      this.missionsBox.replaceChildren();
      // How many teams are out of how many the bunker can field (S5).
      this.missionsBox.appendChild(el('div', 'bp-hint', `[[people]] ${i18n.t('surface.teams', { n: state.activeMissions.length, max: maxTeams(state) })}`));
      for (const m of state.activeMissions) {
        const hex = this.engine.explorationSystem.getHex(state, m.hexX, m.hexY);
        const row = el('div', 'mission-row');
        const names = m.survivorIds
          .map(id => state.survivors.find(s => s.id === id))
          .filter(Boolean)
          .map(s => this.engine.populationSystem.getLocalizedName(s!, i18n.currentLocale))
          .join(', ');
        const biomeName = m.type === 'caravan' ? i18n.t('trade.caravan', { name: getPartner(m.partner)?.name[i18n.currentLocale] ?? '' }) : hex ? BIOMES[hex.biome as BiomeId].name[i18n.currentLocale] : ''; // [LateGame B2]
        const head = el('div', 'bp-row');
        const time = el('span', 'bp-hint');
        head.append(el('span', 'mission-name', `${m.long ? '[[moon]]' : '[[walker]]'} ${biomeName} · ${names}`), time);
        const b = bar(0, 'accent');
        row.append(head, b);
        // Rush: spend a gift charge to skip 15 minutes of the trip (never past a pending radio call).
        row.appendChild(kButton({
          variant: 'secondary',
          className: 'btn-secondary btn-small',
          label: `[[hourglass]] ${i18n.t('rush.button', { n: this.engine.rushSystem.count(state) })}`,
          disabledReason: this.engine.rushSystem.canRushMission(state, m.id) ? null : i18n.t(this.engine.rushSystem.count(state) > 0 ? 'ux2d.rush.waiting' : 'ux2d.rush.none'),
          onPress: () => {
            if (this.engine.rushSystem.rushMission(m.id)) {
              uiSound('confirm');
              this.engine.requestSave();
              this.missionSig = '';
            }
          },
        }));
        this.missionsBox.appendChild(row);
        this.missionBars.set(m.id, { bar: b, time });
      }
    }
    for (const m of state.activeMissions) {
      const refs = this.missionBars.get(m.id);
      if (!refs) continue;
      setBar(refs.bar, (m.progress / m.total) * 100);
      setRich(refs.time, `[[clock]] ${fmtDuration(m.total - m.progress)}`);
    }
  }

  /** [P4] The outpost on this area: its state and yield, or what claiming it takes. */
  private renderOutpost(state: GameState, x: number, y: number): HTMLElement {
    const os = this.engine.outpostSystem;
    const box = el('div', 'bp-card outpost-card');
    const o = os.at(state, x, y);
    const now = state.longGame?.meta.worldT ?? 0;
    if (o) {
      box.appendChild(el('div', 'bp-section-title', `[[flag]] ${i18n.t('outpost.title')}`));
      if (o.readyAt > now) box.appendChild(el('div', 'bp-hint', i18n.t('outpost.building', { t: i18n.formatDuration(o.readyAt - now) })));
      else if (o.damaged) {
        box.appendChild(el('div', 'bp-hint negative-text', i18n.t('outpost.damaged')));
        const cost = os.repairCost(state);
        const can = this.engine.resourceSystem.canAfford(state, cost);
        box.append(costRow(state, cost), kButton({
          label: i18n.t('outpost.repair'),
          disabledReason: can ? null : describeMissing(state, cost),
          onPress: () => { if (os.repair(o.id)) { uiSound('click'); this.engine.requestSave(); } this.redraw(); },
        }));
      } else {
        const y2 = os.yieldPerHour(state, o);
        const pos = Object.entries(y2).filter(([, v]) => (v ?? 0) > 0).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''} +${fmtNum(v ?? 0)}`).join('  ');
        box.appendChild(el('div', 'bp-hint', i18n.t('outpost.yield', { list: pos })));
      }
      return box;
    }
    const block = os.block(state, x, y);
    if (block === 'act' || block === 'home') return el('div');
    box.appendChild(el('div', 'bp-section-title', `[[flag]] ${i18n.t('outpost.claim')}`));
    if (block) {
      box.appendChild(el('div', 'bp-hint', i18n.t(`outpost.block.${block}`, { n: os.max(state) })));
      return box;
    }
    const cost = os.cost(state);
    const can = this.engine.resourceSystem.canAfford(state, cost);
    box.append(
      el('div', 'bp-hint', i18n.t('outpost.claimHint', { t: i18n.formatDuration(os.buildSeconds(state)), n: os.list(state).length, max: os.max(state) })),
      costRow(state, cost),
      kButton({
        label: `[[flag]] ${i18n.t('outpost.build')}`,
        disabledReason: can ? null : describeMissing(state, cost),
        onPress: () => { if (os.build(x, y)) { uiSound('place'); this.engine.requestSave(); } this.redraw(); },
      }),
    );
    return box;
  }

  /**
   * [ux-redesign W2d #9] The regions in reach as a list: each row is a 48 px button that picks it (the map is the picture, the list is
   * the easy way to tap). Unexplored first, then by distance; home (trade) last.
   */
  private renderRegionList(state: GameState): HTMLElement {
    const ex = this.engine.explorationSystem;
    const locale = i18n.currentLocale;
    const box = el('div', 'surface-regions');
    box.appendChild(el('div', 'bp-section-title', `[[map]] ${i18n.t('ux2d.surface.regions')}`));
    const out = new Set(state.activeMissions.map(m => `${m.hexX},${m.hexY}`));
    const regions = state.explorationMap
      .filter(h => h.revealed && h.biome !== 'bunker' && ex.inReach(state, h))
      .sort((a, b) => Number(a.explored) - Number(b.explored) || hexDistance(a.x, a.y) - hexDistance(b.x, b.y));
    if (regions.length === 0) box.appendChild(kEmpty('map', i18n.t('ux2d.surface.noRegions')));
    const full = ex.teamsFull(state);
    // The nearest few first; a later map has hundreds of regions, the rest wait behind "Show all".
    const shown = this.allRegions ? regions : regions.slice(0, REGION_LIST_MAX);
    for (const h of shown) box.appendChild(this.regionRow(state, h, out.has(`${h.x},${h.y}`), full, locale));
    if (shown.length < regions.length) {
      box.appendChild(kButton({
        variant: 'tertiary',
        label: i18n.t('ux2d.surface.showAll', { n: regions.length }),
        onPress: () => { this.allRegions = true; this.cardSig = ''; this.refresh(this.engine.stateManager.state); },
      }));
    }
    const home = state.explorationMap.find(h => h.biome === 'bunker');
    if (home) {
      box.appendChild(kRow({
        icon: 'vault',
        label: `${BIOMES.bunker.name[locale]} · ${i18n.t('trade.title')}`,
        trailing: el('span', 'surface-region__go', flowArrow()),
        onPress: () => this.select(home.x, home.y),
      }));
    }
    const far = state.explorationMap.filter(h => h.revealed && h.biome !== 'bunker' && !ex.inReach(state, h)).length;
    if (far > 0) box.appendChild(el('div', 'bp-hint', `[[car]] ${plural('ux2d.surface.far', far)}`));
    return box;
  }

  private regionRow(state: GameState, h: ExplorationHex, teamOut: boolean, full: boolean, locale: string): HTMLElement {
    const ex = this.engine.explorationSystem;
    const biome = BIOMES[h.biome as BiomeId];
    const poi = h.poi ? POIS[h.poi] : undefined;
    const label = `${h.explored ? '' : '[[question]] '}${biome.name[locale]}${poi ? ` · ${poi.icon} ${poi.name[locale]}` : ''}`;
    const value = `[[clock]] ${fmtDuration(ex.missionDuration(state, h))}`;
    const go = teamOut ? `[[walker]] ${i18n.t('ux2d.surface.out')}` : full ? '' : `${i18n.t('ux2d.surface.plan')} ${flowArrow()}`;
    const row = kRow({ label, value, trailing: el('span', 'surface-region__go', go), onPress: () => this.select(h.x, h.y) });
    row.classList.add('surface-region');
    return row;
  }

  private renderCard(state: GameState): void {
    const hex = this.selected ? this.engine.explorationSystem.getHex(state, this.selected.q, this.selected.r) : undefined;
    const ex = this.engine.explorationSystem;
    // Only free hands go out: survivors posted to a station stay at work (unassign them first to send them).
    const eligible = state.survivors.filter(s => !s.isOnMission && s.health > 25 && !s.assignedBuildingId);
    for (const id of this.team) if (!eligible.some(s => s.id === id)) this.team.delete(id);
    const sig = [
      hex ? `${hex.x},${hex.y},${hex.explored},${hex.poi},${ex.inReach(state, hex)}` : `none|${state.explorationMap.filter(h => h.revealed).length}|${state.explorationMap.filter(h => h.explored).length}`,
      JSON.stringify(state.longGame?.world.outposts ?? []), state.longGame?.meta.act ?? 0, Math.floor((state.longGame?.meta.worldT ?? 0) / 60), // [P4]
      [...this.team].join(','),
      eligible.map(s => s.id).join(','),
      state.activeMissions.map(m => `${m.hexX},${m.hexY}`).join(';'),
      i18n.currentLocale,
      hex?.biome === 'bunker' ? `${JSON.stringify(state.lateGame.trade)}|${state.storyFlags.length}|${Math.floor(state.stats.totalPlayTime / 20)}` : '', // [LateGame B2]
    ].join('|');
    if (sig === this.cardSig) return;
    this.cardSig = sig;

    if (!hex) {
      this.card.replaceChildren(this.renderRegionList(state));
      return;
    }
    const locale = i18n.currentLocale;
    const biome = BIOMES[hex.biome as BiomeId];
    const box = el('div', 'bp');
    box.appendChild(kButton({
      variant: 'tertiary',
      className: 'btn-ghost surface-back',
      label: `${flowArrow() === '[[arrowLeft]]' ? '[[arrowRight]]' : '[[arrowLeft]]'} ${i18n.t('ux2d.surface.allRegions')}`,
      onPress: () => { this.selected = null; this.team.clear(); this.mapSig = this.cardSig = ''; this.refresh(this.engine.stateManager.state); },
    }));
    const title = el('div', 'bp-row');
    const poi = hex.poi ? POIS[hex.poi] : undefined;
    title.append(
      el('span', 'research-name', `${biome.name[locale]}${poi ? ` · ${poi.icon} ${poi.name[locale]}` : ''}`),
      el('span', 'danger', '[[skull]]'.repeat(Math.max(0, biome.danger)) || '—'),
    );
    box.appendChild(title);

    if (hex.biome === 'bunker') {
      box.appendChild(el('div', 'bp-hint', i18n.t('surface.home')));
      box.appendChild(renderTrade(this.engine, state, () => { this.cardSig = this.missionSig = ''; this.refresh(this.engine.stateManager.state); })); // [LateGame B2]
      this.card.replaceChildren(box);
      return;
    }

    const info = el('div', 'surface-info');
    info.append(
      el('span', '', `[[ruler]] ${hexDistance(hex.x, hex.y)}`),
      el('span', '', `[[clock]] ${fmtDuration(ex.missionDuration(state, hex))}`),
      el('span', '', hex.explored ? `[[check]] ${i18n.t('surface.explored')}` : `[[question]] ${i18n.t('surface.unexplored')}`),
    );
    box.appendChild(info);

    box.appendChild(this.renderOutpost(state, hex.x, hex.y)); // [P4]
    const loot = el('div', 'cost-row');
    const lootTypes = new Set<string>(Object.keys(biome.loot));
    if (poi) Object.keys(poi.loot).forEach(k => lootTypes.add(k));
    for (const r of lootTypes) loot.appendChild(el('span', 'cost-chip affordable', RESOURCE_ICONS[r] ?? r));
    if (poi?.recruit) loot.appendChild(el('span', 'cost-chip affordable', '[[person]]'));
    box.appendChild(loot);

    if (state.activeMissions.some(m => m.hexX === hex.x && m.hexY === hex.y)) {
      box.appendChild(el('div', 'bp-hint', `[[walker]] ${i18n.t('surface.teamOut')}`));
      this.card.replaceChildren(box);
      return;
    }
    // The outer rings are beyond walking range; every team may already be out.
    if (!ex.inReach(state, hex) || ex.teamsFull(state)) {
      box.appendChild(el('div', 'bp-hint', !ex.inReach(state, hex) ? `[[car]] ${i18n.t('surface.needsVehicles')}` : `[[people]] ${i18n.t('surface.teamsFull')}`));
      this.card.replaceChildren(box);
      return;
    }

    box.appendChild(el('div', 'bp-section-title', i18n.t('surface.chooseTeam', { n: MAX_TEAM })));
    const chips = el('div', 'team-chips');
    if (eligible.length === 0) chips.appendChild(kEmpty('people', i18n.t('surface.noTeam')));
    for (const s of eligible) {
      const on = this.team.has(s.id);
      const power = Math.round((s.stats.strength + s.stats.agility + s.stats.endurance) / 3);
      const chip = kButton({
        variant: 'secondary',
        className: `team-chip ${on ? 'on' : ''}`,
        label: `${this.engine.populationSystem.getLocalizedName(s, locale)} ${STAT_ICONS.strength}${power}`,
        disabledReason: on || this.team.size < MAX_TEAM ? null : i18n.t('ux2d.surface.teamMax', { n: MAX_TEAM }),
        onPress: () => {
          if (on) this.team.delete(s.id);
          else if (this.team.size < MAX_TEAM) this.team.add(s.id);
          this.cardSig = '';
          this.refresh(this.engine.stateManager.state);
        },
      });
      chip.setAttribute('aria-pressed', String(on));
      chips.appendChild(chip);
    }
    box.appendChild(chips);

    const team = eligible.filter(s => this.team.has(s.id));
    const chance = Math.round(ex.successChance(state, hex, team) * 100);
    const go = (long: boolean) => {
      if (ex.send(hex, [...this.team], long)) {
        uiSound('depart');
        this.team.clear();
        this.selected = null;
        this.engine.requestSave();
        this.redraw();
      }
    };
    const why = ex.canSend(state, hex, [...this.team]) ? null : team.length === 0 ? i18n.t('ux2d.surface.pickTeam') : '';
    const send = kButton({
      label: team.length > 0 ? `[[walker]] ${i18n.t('surface.send')} · ${chance}%` : i18n.t('surface.send'),
      disabledReason: why,
      onPress: () => go(false),
    });
    // The long haul: six times the trip, four times the loot. Made for a night away.
    const long = kButton({
      variant: 'secondary',
      label: `[[moon]] ${i18n.t('surface.long', { t: i18n.formatDuration(ex.missionDuration(state, hex, true)) })}`,
      disabledReason: why,
      onPress: () => go(true),
    });
    const sendRow = el('div', 'btn-row');
    sendRow.append(send, long);
    box.append(sendRow, el('div', 'bp-hint', `[[backpack]] ${i18n.t('surface.longHint')}`));
    this.card.replaceChildren(box);
  }
}
