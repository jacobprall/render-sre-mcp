import type { TopologySnapshot } from './types.js';

const DEFAULT_ACTED_ON_TTL_MS = 15 * 60 * 1000;

export class HotResourceTracker {
  private actedOn = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_ACTED_ON_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  markActedOn(resourceId: string): void {
    this.actedOn.set(resourceId, Date.now());
  }

  isActedOn(resourceId: string): boolean {
    const at = this.actedOn.get(resourceId);
    if (!at) return false;
    if (Date.now() - at > this.ttlMs) {
      this.actedOn.delete(resourceId);
      return false;
    }
    return true;
  }

  getActedOnIds(): string[] {
    const now = Date.now();
    const ids: string[] = [];
    for (const [id, at] of this.actedOn) {
      if (now - at <= this.ttlMs) ids.push(id);
      else this.actedOn.delete(id);
    }
    return ids;
  }
}

let singleton: HotResourceTracker | null = null;

export function getHotResourceTracker(): HotResourceTracker {
  if (!singleton) singleton = new HotResourceTracker();
  return singleton;
}

export function computeHotServiceIds(
  snapshot: TopologySnapshot,
  tracker: HotResourceTracker
): Set<string> {
  const hot = new Set<string>();
  for (const svc of snapshot.services) {
    if (svc.suspended === 'suspended') hot.add(svc.id);
    if (tracker.isActedOn(svc.id)) hot.add(svc.id);
  }
  return hot;
}

export function computeHotResourceIds(
  snapshot: TopologySnapshot,
  tracker: HotResourceTracker
): Set<string> {
  const hot = computeHotServiceIds(snapshot, tracker);
  for (const db of snapshot.databases) {
    if (db.status !== 'available') hot.add(db.id);
    if (tracker.isActedOn(db.id)) hot.add(db.id);
  }
  for (const kv of snapshot.keyValueStores) {
    if (kv.status !== 'available') hot.add(kv.id);
    if (tracker.isActedOn(kv.id)) hot.add(kv.id);
  }
  return hot;
}
