type Handler = (...args: unknown[]) => void;

export class EventBus {
  private listeners = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: Handler): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach(h => h(...args));
  }

  once(event: string, handler: Handler): () => void {
    const wrapped = (...args: unknown[]) => {
      this.off(event, wrapped);
      handler(...args);
    };
    return this.on(event, wrapped);
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const bus = new EventBus();
