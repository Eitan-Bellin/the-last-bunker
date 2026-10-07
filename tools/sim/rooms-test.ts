// [plan4:BL-15..32] Node-level checks of the twelve wave 2 rooms on the sample saves (run by rooms-test.mjs): each room's effect reaches its reader
// with the number buildings.json promises, the weather rooms follow the sun and the wind, children go to the nursery and the school (never to a crew
// place), the fish ponds need the lake, the memorial hall needs its flag, and every room has the data the game looks up (icon, role pair, research).
import { BuildingSystem } from '../../src/systems/BuildingSystem';
import { PopulationSystem } from '../../src/systems/PopulationSystem';
import { ResourceSystem } from '../../src/systems/ResourceSystem';
import { DeathSystem } from '../../src/systems/DeathSystem';
import { StateManager } from '../../src/core/StateManager';
import { isBuildingUnlocked, unlockingResearch } from '../../src/systems/ResearchSystem';
import { BUILDABLE_TYPES, getDef, effectiveLevel } from '../../src/data/buildingDefs';
import { cargoMult, childCapacityOf, earlyWarningLead, expeditionTeamsBonus, hygieneMult, mourningMult, quarantineCapacity, returnSafetyMult, roomChildGrowth } from '../../src/data/roomEffects';
import { specsFor } from '../../src/data/specializations';
import { timeOfDay, windAt } from '../../src/data/dayCycle';
import { ICON_SVG } from '../../src/ui/icons';
import { BUILDING_ICONS } from '../../src/ui/dom';
import { migrateState, type BuildingInstance, type BuildingType, type GameState, type SurvivorState } from '../../src/core/GameState';

export const WAVE2: BuildingType[] = ['quarantineWard', 'solarArray', 'windTurbine', 'watchtower', 'garage', 'decon', 'aquaculture', 'market', 'nursery', 'school', 'bathhouse', 'memorialHall'];

export function roomsChecks(games: { name: string; json: string }[]): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const fail = (m: string): void => { if (problems.length < 25) problems.push(m); };
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
  const bs = new BuildingSystem();
  const rs = new ResourceSystem();
  const ps = new PopulationSystem();

  // ---- data every room needs, independent of any save ----
  for (const t of WAVE2) {
    if (!(t in ICON_SVG)) fail(`${t}: no icon`);
    if (!BUILDING_ICONS[t]) fail(`${t}: no BUILDING_ICONS entry`);
    if (!BUILDABLE_TYPES.includes(t)) fail(`${t}: not in BUILDABLE_TYPES`);
    if (specsFor(t).length !== 2) fail(`${t}: ${specsFor(t).length} roles, expected 2`);
    const r = unlockingResearch(t);
    if (!r && t !== 'memorialHall') fail(`${t}: no unlocking research`);
    if (t === 'memorialHall' && (r || !getDef(t)?.place?.needsFlag)) fail('memorialHall must open by its story flag and have no research');
  }

  for (const g of games) {
    const base = migrateState(JSON.parse(g.json) as GameState);
    for (const r of Object.values(base.resources)) r.amount = r.cap;
    base.buildings = base.buildings.filter(b => !WAVE2.includes(b.type));
    base.storyFlags = base.storyFlags.filter(f => f !== 'memorial:first');
    let n = 0;
    const mk = (type: BuildingType, level: number, floor: number, x: number): BuildingInstance =>
      ({ id: `w2_${type}_${n++}`, type, level, position: { x, y: 0, floor }, assignedSurvivorIds: [], constructionProgress: 0, constructionTotal: 0, isConstructing: false, specialization: null });
    const withRooms = (rooms: BuildingInstance[]): GameState => ({ ...base, buildings: [...base.buildings, ...rooms] });

    // ---- effects reach their readers with the promised numbers ----
    const ward = (lvl: number) => withRooms([mk('quarantineWard', lvl, 40, 0)]);
    if (quarantineCapacity(ward(1)) !== 4 || quarantineCapacity(ward(3)) !== 6) fail(`${g.name}: quarantine ward holds ${quarantineCapacity(ward(1))}/${quarantineCapacity(ward(3))}, expected 4/6 at levels 1/3`);
    if (earlyWarningLead(withRooms([mk('watchtower', 1, 40, 0)])) !== 30) fail(`${g.name}: watchtower L1 gives ${earlyWarningLead(withRooms([mk('watchtower', 1, 40, 0)]))}s of warning, expected 30`);
    if (earlyWarningLead(withRooms([mk('watchtower', 10, 40, 0), mk('watchtower', 10, 40, 2)])) !== 300) fail(`${g.name}: raid warning is not capped at 300s`);
    if (expeditionTeamsBonus(withRooms([mk('garage', 2, 40, 0)])) !== 0 || expeditionTeamsBonus(withRooms([mk('garage', 3, 40, 0)])) !== 1 || expeditionTeamsBonus(withRooms([mk('garage', 8, 40, 0)])) !== 2) fail(`${g.name}: motor pool teams are not 0/1/2 at levels 2/3/8`);
    if (!near(cargoMult(withRooms([mk('garage', 3, 40, 0), mk('market', 1, 40, 4)])), 1 + 0.15 + 0.1)) fail(`${g.name}: garage L3 + market L1 cargo is ${cargoMult(withRooms([mk('garage', 3, 40, 0), mk('market', 1, 40, 4)]))}, expected 1.25`);
    if (!near(returnSafetyMult(withRooms([mk('decon', 1, 40, 0)])), 0.96)) fail(`${g.name}: decon L1 return safety is not 0.96`);
    if (!near(hygieneMult(withRooms([mk('bathhouse', 1, 40, 0)])), 0.96)) fail(`${g.name}: bathhouse L1 hygiene is not 0.96`);
    if (!near(mourningMult(withRooms([mk('memorialHall', 1, 40, 0)])), 0.9)) fail(`${g.name}: memorial hall L1 mourning is not 0.9`);
    if (!near(roomChildGrowth(withRooms([mk('nursery', 1, 40, 0)])), 1.25)) fail(`${g.name}: nursery L1 child growth is not 1.25`);
    if (childCapacityOf(mk('nursery', 1, 0, 0)) !== 4 || childCapacityOf(mk('nursery', 3, 0, 0)) !== 8 || childCapacityOf(mk('school', 1, 0, 0)) !== 6) fail(`${g.name}: child places are not 4/8/6 (nursery L1, L3, school L1)`);

    // ---- weather: the sun and the wind move the power ----
    {
      const s = withRooms([mk('solarArray', 1, -1, 0), mk('windTurbine', 1, -1, 4)]);
      const solar = s.buildings[s.buildings.length - 2], wind = s.buildings[s.buildings.length - 1];
      let day = -1, night = -1, calm = -1, gust = -1;
      for (let t = 0; t < 60000; t += 10) {
        const nt = timeOfDay(t).night;
        if (day < 0 && nt === 0) day = t;
        if (night < 0 && nt === 1) night = t;
        if (calm < 0 && windAt(t) < 0.1) calm = t;
        if (gust < 0 && windAt(t) > 0.9) gust = t;
      }
      const out = (b: BuildingInstance, t: number) => { s.stats.totalPlayTime = t; return rs.getBuildingOutput(s, b).power ?? 0; };
      if (!(out(solar, day) > 2.5)) fail(`${g.name}: solar array makes ${out(solar, day)} power at noon, expected about 3`);
      if (out(solar, night) !== 0) fail(`${g.name}: solar array makes power at night (${out(solar, night)})`);
      if (!(out(wind, gust) > out(wind, calm) * 1.5)) fail(`${g.name}: wind turbine does not follow the wind (${out(wind, calm)} calm, ${out(wind, gust)} gust)`);
    }

    // ---- children: nursery and school hold them, a crew place never does ----
    {
      const sm = new StateManager();
      const st = withRooms([mk('nursery', 1, 40, 0), mk('school', 1, 40, 4)]);
      sm.loadState(st);
      const nursery = sm.state.buildings.find(b => b.type === 'nursery')!;
      const school = sm.state.buildings.find(b => b.type === 'school')!;
      const kid = (i: number): SurvivorState => ({ ...sm.state.survivors[0], id: `w2kid${i}`, name: `kid${i}`, child: true, assignedBuildingId: null, bornAt: 0, isOnMission: false } as SurvivorState);
      const kids = [0, 1, 2, 3, 4, 5].map(kid);
      sm.applyDelta({ path: 'survivors', value: [...sm.state.survivors, ...kids] });
      let placed = 0;
      for (const k of kids) if (ps.assignSurvivorToBuilding(sm, k.id, nursery.id)) placed++;
      if (placed !== 4) fail(`${g.name}: nursery L1 took ${placed} children, expected 4`);
      const left = kids.find(k => sm.state.survivors.find(s => s.id === k.id)?.assignedBuildingId === null);
      if (left && !ps.assignSurvivorToBuilding(sm, left.id, school.id)) fail(`${g.name}: the school refused a child`);
      const workshop = sm.state.buildings.find(b => b.type === 'workshop');
      if (workshop && ps.assignSurvivorToBuilding(sm, kids[0].id, workshop.id)) fail(`${g.name}: a child was put on a workshop crew`);
    }

    // ---- placement: the roof row, the lake, the flag ----
    {
      const open = { ...base, layout: { ...base.layout, surfaceOpen: true } };
      if (bs.placeBlock('solarArray', { x: -8, y: 0, floor: -1 }, open) !== null) fail(`${g.name}: solar array refused on an open roof row`);
      if (bs.placeBlock('solarArray', { x: -8, y: 0, floor: -1 }, { ...base, layout: { ...base.layout, surfaceOpen: false } }) !== 'surface') fail(`${g.name}: solar array was accepted with the roof row closed`);
      if (bs.placeBlock('solarArray', { x: 0, y: 0, floor: 0 }, open) === null) fail(`${g.name}: solar array was accepted underground`);
      if (bs.placeBlock('memorialHall', { x: 0, y: 0, floor: 0 }, base) !== 'locked') fail(`${g.name}: memorial hall is not locked without its flag`);
      if (isBuildingUnlocked(base, 'memorialHall')) fail(`${g.name}: memorial hall counts as unlocked without its flag`);
      const lake = base.buildings.find(b => b.type === 'lake');
      const pond = bs.placeBlock('aquaculture', { x: 0, y: 0, floor: lake?.position.floor ?? 1 }, { ...base, buildings: base.buildings.filter(b => b.type !== 'lake') });
      if (pond !== 'adjacency' && pond !== 'overlap' && pond !== 'zone' && pond !== 'bounds') fail(`${g.name}: fish ponds without a lake gave ${pond ?? 'free'}`);
      if (lake) {
        const f = lake.position.floor;
        const free = [...Array(24).keys()].map(i => lake.position.x - 3 - i).find(x => bs.placeBlock('aquaculture', { x, y: 0, floor: f }, base) === null);
        notes.push(`${g.name}: fish ponds ${free === undefined ? 'have no free spot beside the lake' : `fit at slot ${free} beside the lake on floor ${f}`}`);
      } else notes.push(`${g.name}: no lake yet`);
    }

    // ---- [plan4:polish] fish ponds beside the lake: the sample saves have no free spot there, so clear the lake's neighbours and build one ----
    {
      const lake = base.buildings.find(b => b.type === 'lake');
      if (!lake) fail(`${g.name}: no lake district to build fish ponds beside`);
      else {
        const f = lake.position.floor;
        const w = getDef('aquaculture')!.slots ?? 3;
        const at = lake.position.x - w; // touching the lake's west edge
        const clear = (s: GameState): GameState => ({
          ...s,
          buildings: s.buildings.filter(b => !(b.position.floor === f && b.type !== 'lake' && b.position.x < at + w && b.position.x + (getDef(b.type)?.slots ?? 3) > at - 4)),
          ruins: (s.ruins ?? []).filter(r => !(r.floor === f && r.x < at + w && r.x + r.w > at - 4)),
          layout: { ...s.layout, infra: (s.layout.infra ?? []).filter(i => i.kind === 'bulkhead' || i.x < at - 4 || i.x >= at + w) },
        });
        const free = clear(base);
        free.research = { ...free.research, aquaculture: { id: 'aquaculture', completed: true, progress: 0, total: 0, isResearching: false } };
        free.buildings = free.buildings.filter(b => b.type !== 'aquaculture');
        const reason = bs.placeBlock('aquaculture', { x: at, y: 0, floor: f }, free);
        // (zone: the fish ponds may only stand on floors their zone allows; the lake is on its own floor, so a 'zone' answer here means data drift)
        if (reason !== null) fail(`${g.name}: fish ponds refused at slot ${at} of floor ${f} touching the lake: ${reason}`);
        else {
          if (bs.placeBlock('aquaculture', { x: at - 1, y: 0, floor: f }, free) !== 'adjacency') fail(`${g.name}: fish ponds one slot away from the lake were not refused for adjacency`);
          if (bs.placeBlock('aquaculture', { x: at, y: 0, floor: f + 1 }, free) === null) fail(`${g.name}: fish ponds on a floor without the lake were accepted`);
          const sm = new StateManager();
          sm.loadState(JSON.parse(JSON.stringify(free)) as GameState);
          bs.syncNextId(sm.state); // (the game does this on every load; ids would clash with the sample's rooms)
          const pond = bs.placeBuilding('aquaculture', { x: at, y: 0, floor: f }, sm);
          if (!pond) fail(`${g.name}: placeBuilding did not build the fish ponds`);
          else {
            if (bs.placeBlock('aquaculture', { x: at, y: 0, floor: f }, sm.state) === null) fail(`${g.name}: a second fish pond spot was offered`);
            const done = { ...sm.state, buildings: sm.state.buildings.map(b => (b.id === pond.id ? { ...b, isConstructing: false, constructionProgress: b.constructionTotal, assignedSurvivorIds: [] } : b)) };
            const out = rs.getBuildingOutput(done, done.buildings.find(b => b.id === pond.id)!);
            if (!(typeof out.food === 'number' && out.food >= 0)) fail(`${g.name}: fish ponds have no food output entry: ${JSON.stringify(out)} lvl ${effectiveLevel(done.buildings.find(b => b.id === pond.id)!)} inc ${JSON.stringify(done.incidents)}`);
            const demol = new StateManager();
            demol.loadState(JSON.parse(JSON.stringify(done)) as GameState);
            if (!bs.demolish(demol, pond.id)) fail(`${g.name}: fish ponds could not be torn down: ${bs.demolishBlock(demol.state, pond.id)}`);
            else if (bs.placeBlock('aquaculture', { x: at, y: 0, floor: f }, demol.state) !== null) fail(`${g.name}: the fish pond spot did not come back after tearing the ponds down`);
          }
          notes.push(`${g.name}: fish ponds built beside the lake at slot ${at} of floor ${f} (cleared neighbours)`);
        }
      }
    }

    // ---- the first remembered death opens the memorial hall ----
    {
      const sm = new StateManager();
      sm.loadState(JSON.parse(JSON.stringify(base)) as GameState);
      const ds = new DeathSystem(sm);
      const dead = sm.state.survivors[0];
      if (dead) {
        ds.onDeath(dead);
        if (sm.state.storyFlags.includes('memorial:first')) fail(`${g.name}: memorial:first is set before the memorial was answered`);
        ds.answerMemorial('carryOn', rs);
        if (!sm.state.storyFlags.includes('memorial:first')) fail(`${g.name}: answering the first memorial did not set memorial:first`);
        if (!isBuildingUnlocked(sm.state, 'memorialHall')) fail(`${g.name}: memorial hall stays locked after the flag`);
      }
    }
    notes.push(`${g.name}: wave 2 effects, weather, children, placement and the memorial flag checked`);
    void effectiveLevel;
  }
  return { problems, notes };
}
