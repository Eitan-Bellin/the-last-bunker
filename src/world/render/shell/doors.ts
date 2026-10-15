/**
 * [world:M1] Bulkhead doors in the city (architecture 4 "Sealed door" / "Shut door"). infra.ts draws the door itself on the city projection
 * (leaf, frame, straps and the SEALED sign); the shell gives each door that is not open its light in the city's lightmap, so a shut
 * floor reads from across the city: a closed bulkhead burns an AMBER lamp over its lintel, a sealed one a RED emergency lamp (infra draws
 * the straps and the weld). Steady lights (never a hard flash: a11y), each on its storey's area.
 */
import { Container } from 'pixi.js';
import type { GameState } from '../../../core/GameState';
import { ROOM_H, floorTop } from '../../../rendering/geom';
import { DOOR_H } from '../../../rendering/openings';
import { PROPS } from '../../tokens';
import { slotX } from '../../project';
import type { LightDef, ShellPiece } from './types';

const LIP = 3;

export function buildDoors(state: Partial<Pick<GameState, 'layout' | 'currentFloors'>>): ShellPiece {
  const front = new Container();
  front.label = 'doors:front';
  const lights: LightDef[] = [];
  const doors = state.layout?.doors;
  if (!doors) return { front, lights };
  const floors = state.currentFloors ?? 0;
  for (const key of Object.keys(doors).sort()) {
    const st = doors[key];
    if (st !== 'closed' && st !== 'sealed') continue;
    const m = /^(-?\d+):(-?\d+)$/.exec(key);
    if (!m) continue;
    const floor = +m[1], slot = +m[2];
    if (floor < 0 || floor >= floors) continue;
    const x = slotX(floor, slot);
    const y1 = floorTop(floor) + ROOM_H - LIP, y0 = y1 - DOOR_H;
    const area = `f:${floor}`;
    if (st === 'closed') {
      lights.push({ x, y: y0 - 6, preset: 'wallLamp', color: PROPS.doors.shut, radius: 70, intensity: 0.8, flicker: 'steady', kind: 'shell', area });
    } else {
      lights.push({ x, y: y0 - 6, preset: 'emergency', color: PROPS.doors.sealed, radius: 80, intensity: 0.75, flicker: 'steady', kind: 'shell', area });
    }
  }
  return { front, lights };
}
