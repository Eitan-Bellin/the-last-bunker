import type { GameState } from '../../core/GameState';
import type { GameEngine } from '../../core/GameEngine';
import { i18n } from '../../i18n/I18nManager';
import { BIOMES, MAP_RADIUS, POIS, hexDistance, mapRadiusFor, type BiomeId } from '../../data/surface';
import { MAX_TEAM, maxTeams } from '../../systems/ExplorationSystem';
import { RESOURCE_ICONS, STAT_ICONS, bar, button, el, setBar, setRich , costRow } from '../dom';
import { uiSound } from '../../audio/uiSound';
import { renderTrade } from './TradePanel'; // [LateGame B2]
import { getPartner } from '../../data/trade';
import { ICON_SVG, isIcon } from '../icons';
import { ensureBiomeTiles, paintWorldMap } from './worldMap'; // plan 2026-10 M6

const S = 20;
const SQRT3 = Math.sqrt(3);

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

function css(color: number, factor = 1): string {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return `rgb(${r},${g},${b})`;
}

/** Full-screen surface map: pick a hex, choose a team, send an expedition. */
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

  onOpenResearch: (() => void) | null = null;

  constructor(engine: GameEngine) {
    this.engine = engine;
    this.overlay = el('div', 'surface-overlay');
    const header = el('div', 'surface-header');
    header.append(el('h2', 'sheet-title', `[[surface]] ${i18n.t('surface.title')}`), button('[[close]]', 'btn-small btn-ghost surface-close', () => this.hide()));
    // [plan4:AC-8] A dialog with a name; its close button has one too.
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', i18n.t('surface.title'));
    header.querySelector('.surface-close')?.setAttribute('aria-label', i18n.t('journal.close'));
    this.missionsBox = el('div', 'surface-missions');
    this.mapBox = el('div', 'surface-map');
    this.card = el('div', 'surface-card');
    this.mapBox.addEventListener('click', (e) => {
      const g = (e.target as Element).closest('[data-q]');
      if (!g) return;
      this.selected = { q: Number(g.getAttribute('data-q')), r: Number(g.getAttribute('data-r')) };
      this.team.clear();
      this.mapSig = '';
      this.cardSig = '';
      this.refresh(this.engine.stateManager.state);
    });
    this.overlay.append(header, this.missionsBox, this.mapBox, this.card);
    document.body.appendChild(this.overlay);
  }

  show(): void {
    this.engine.explorationSystem.ensureMap();
    this.mapSig = this.cardSig = this.missionSig = '';
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

  refresh(state: GameState): void {
    if (!this.engine.explorationSystem.isUnlocked(state)) {
      if (this.mapSig !== 'locked') {
        this.mapSig = 'locked';
        this.missionsBox.replaceChildren();
        this.card.replaceChildren();
        const box = el('div', 'surface-locked');
        box.append(
          el('div', 'modal-icon', '[[gasmask]]'),
          el('p', 'modal-body', i18n.t('surface.locked')),
          button(`[[research]] ${i18n.t('hud.research')}`, 'btn-primary', () => this.onOpenResearch?.()),
        );
        this.mapBox.replaceChildren(box);
      }
      return;
    }
    this.renderMap(state);
    this.renderMissions(state);
    this.renderCard(state);
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
    const parts: string[] = [];
    // Plan 2026-10 M6: the terrain is painted on a canvas behind the SVG, which keeps the clicks, icons and rings.
    parts.push(`<div class="map-wrap" style="aspect-ratio:${w.toFixed(1)}/${h.toFixed(1)}"><canvas class="map-paint"></canvas><svg viewBox="${-w / 2} ${-h / 2} ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`);
    const targets = new Set(state.activeMissions.map(m => `${m.hexX},${m.hexY}`));

    for (const hex of state.explorationMap) {
      const { x, y } = hexCenter(hex.x, hex.y);
      const biome = BIOMES[hex.biome as BiomeId];
      const sel = this.selected && this.selected.q === hex.x && this.selected.r === hex.y;
      // The colour of a hex now comes from the painted terrain behind; the polygon only catches taps and marks the selection.
      const fill = hex.revealed ? 'rgba(0,0,0,0.001)' : 'none';
      const stroke = 'none';
      const attrs = hex.revealed ? ` data-q="${hex.x}" data-r="${hex.y}" class="hex"` : ' class="hex fog"';
      parts.push(`<g${attrs}><polygon points="${hexPoints(x, y)}" fill="${fill}" stroke="${sel ? '#ffffff' : stroke}" stroke-width="${sel ? 2.5 : 1}"/>`);
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
        const cls = op.damaged ? 'outpost-flag damaged' : op.readyAt > (state.longGame?.meta.worldT ?? 0) ? 'outpost-flag building' : 'outpost-flag';
        parts.push(`<g class="${cls}" transform="translate(${(x + 2).toFixed(1)} ${(y - S * 0.85).toFixed(1)}) scale(0.45)">${ICON_SVG.flag}</g>`);
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
    this.mapBox.innerHTML = parts.join('');
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
        row.appendChild(button(`[[hourglass]] ${i18n.t('rush.button', { n: this.engine.rushSystem.count(state) })}`, 'btn-secondary btn-small', () => {
          if (this.engine.rushSystem.rushMission(m.id)) {
            uiSound('confirm');
            this.engine.requestSave();
            this.missionSig = '';
          }
        }, !this.engine.rushSystem.canRushMission(state, m.id)));
        this.missionsBox.appendChild(row);
        this.missionBars.set(m.id, { bar: b, time });
      }
    }
    for (const m of state.activeMissions) {
      const refs = this.missionBars.get(m.id);
      if (!refs) continue;
      setBar(refs.bar, (m.progress / m.total) * 100);
      setRich(refs.time, `[[clock]] ${i18n.formatDuration(m.total - m.progress)}`);
    }
  }

  /** [P4] The outpost on this area: its state and yield, or what claiming it takes. */
  private renderOutpost(state: GameState, x: number, y: number): HTMLElement {
    const os = this.engine.outpostSystem;
    const box = el('div', 'bp-card outpost-card');
    const o = os.at(state, x, y);
    const now = state.longGame?.meta.worldT ?? 0;
    const refresh = () => { this.cardSig = this.mapSig = ''; this.refresh(this.engine.stateManager.state); };
    if (o) {
      box.appendChild(el('div', 'bp-section-title', `[[flag]] ${i18n.t('outpost.title')}`));
      if (o.readyAt > now) box.appendChild(el('div', 'bp-hint', i18n.t('outpost.building', { t: i18n.formatDuration(o.readyAt - now) })));
      else if (o.damaged) {
        box.appendChild(el('div', 'bp-hint negative-text', i18n.t('outpost.damaged')));
        const cost = os.repairCost(state);
        box.append(costRow(state, cost), button(i18n.t('outpost.repair'), 'btn-primary', () => { if (os.repair(o.id)) { uiSound('click'); this.engine.requestSave(); } refresh(); }, !this.engine.resourceSystem.canAfford(state, cost)));
      } else {
        const y2 = os.yieldPerHour(state, o);
        const pos = Object.entries(y2).filter(([, v]) => (v ?? 0) > 0).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''} +${i18n.formatCompact(v ?? 0)}`).join('  ');
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
    box.append(
      el('div', 'bp-hint', i18n.t('outpost.claimHint', { t: i18n.formatDuration(os.buildSeconds(state)), n: os.list(state).length, max: os.max(state) })),
      costRow(state, cost),
      button(`[[flag]] ${i18n.t('outpost.build')}`, 'btn-primary', () => { if (os.build(x, y)) { uiSound('place'); this.engine.requestSave(); } refresh(); }, !this.engine.resourceSystem.canAfford(state, cost)),
    );
    return box;
  }

  private renderCard(state: GameState): void {
    const hex = this.selected ? this.engine.explorationSystem.getHex(state, this.selected.q, this.selected.r) : undefined;
    const ex = this.engine.explorationSystem;
    // Only free hands go out: survivors posted to a station stay at work (unassign them first to send them).
    const eligible = state.survivors.filter(s => !s.isOnMission && s.health > 25 && !s.assignedBuildingId);
    for (const id of this.team) if (!eligible.some(s => s.id === id)) this.team.delete(id);
    const sig = [
      hex ? `${hex.x},${hex.y},${hex.explored},${hex.poi},${ex.inReach(state, hex)}` : 'none',
      JSON.stringify(state.longGame?.world.outposts ?? []), state.longGame?.meta.act ?? 0, Math.floor((state.longGame?.meta.worldT ?? 0) / 60), // [P4]
      [...this.team].join(','),
      eligible.map(s => s.id).join(','),
      state.activeMissions.length,
      hex?.biome === 'bunker' ? `${JSON.stringify(state.lateGame.trade)}|${state.storyFlags.length}|${Math.floor(state.stats.totalPlayTime / 20)}` : '', // [LateGame B2]
    ].join('|');
    if (sig === this.cardSig) return;
    this.cardSig = sig;

    if (!hex) {
      this.card.replaceChildren(el('div', 'bp-hint center', i18n.t('surface.pickHex')));
      return;
    }
    const locale = i18n.currentLocale;
    const biome = BIOMES[hex.biome as BiomeId];
    const box = el('div', 'bp');
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
      el('span', '', `[[clock]] ${i18n.formatDuration(ex.missionDuration(state, hex))}`),
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
    if (eligible.length === 0) chips.appendChild(el('div', 'bp-hint', i18n.t('surface.noTeam')));
    for (const s of eligible) {
      const on = this.team.has(s.id);
      const power = Math.round((s.stats.strength + s.stats.agility + s.stats.endurance) / 3);
      const chip = button(
        `${this.engine.populationSystem.getLocalizedName(s, locale)} ${STAT_ICONS.strength}${power}`,
        `team-chip ${on ? 'on' : ''}`,
        () => {
          if (on) this.team.delete(s.id);
          else if (this.team.size < MAX_TEAM) this.team.add(s.id);
          this.cardSig = '';
          this.refresh(this.engine.stateManager.state);
        },
      );
      chips.appendChild(chip);
    }
    box.appendChild(chips);

    const team = eligible.filter(s => this.team.has(s.id));
    const chance = Math.round(ex.successChance(state, hex, team) * 100);
    const go = (long: boolean) => {
      if (ex.send(hex, [...this.team], long)) {
        uiSound('depart');
        this.team.clear();
        this.engine.requestSave();
        this.mapSig = this.cardSig = this.missionSig = '';
        this.refresh(this.engine.stateManager.state);
      }
    };
    const blocked = !ex.canSend(state, hex, [...this.team]);
    const send = button(
      team.length > 0 ? `[[walker]] ${i18n.t('surface.send')} · ${chance}%` : i18n.t('surface.send'),
      'btn-primary',
      () => go(false),
      blocked,
    );
    // The long haul: six times the trip, four times the loot. Made for a night away.
    const long = button(
      `[[moon]] ${i18n.t('surface.long', { t: i18n.formatDuration(ex.missionDuration(state, hex, true)) })}`,
      'btn-secondary',
      () => go(true),
      blocked,
    );
    const sendRow = el('div', 'btn-row');
    sendRow.append(send, long);
    box.append(sendRow, el('div', 'bp-hint', `[[backpack]] ${i18n.t('surface.longHint')}`));
    this.card.replaceChildren(box);
  }
}
