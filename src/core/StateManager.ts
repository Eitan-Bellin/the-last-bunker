import type { GameState } from './GameState';
import { createInitialState } from './GameState';
import { bus } from './EventBus';

export type StateDelta = {
  path: string;
  value: unknown;
};

export class StateManager {
  private _state: GameState;

  constructor() {
    this._state = createInitialState();
  }

  get state(): Readonly<GameState> {
    return this._state;
  }

  loadState(state: GameState): void {
    this._state = state;
    bus.emit('state:loaded');
  }

  applyDelta(delta: StateDelta): void {
    setNestedValue(this._state as unknown as Record<string, unknown>, delta.path, delta.value);
    bus.emit('state:changed', delta.path);
  }

  applyDeltas(deltas: StateDelta[]): void {
    for (const delta of deltas) {
      setNestedValue(this._state as unknown as Record<string, unknown>, delta.path, delta.value);
    }
    bus.emit('state:changed', 'batch');
  }

  getSnapshot(): GameState {
    return JSON.parse(JSON.stringify(this._state));
  }

  reset(): void {
    this._state = createInitialState();
    bus.emit('state:loaded');
  }
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}
