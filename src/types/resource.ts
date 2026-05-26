import type { TopologySnapshot } from './topology.js';

export const ID_PREFIX = {
  service: 'srv-',
  postgres: 'dpg-',
  keyvalue: 'red-',
} as const;

export type ResourceType = 'service' | 'postgres' | 'keyvalue';

export function getResourceType(id: string): ResourceType | null {
  if (id.startsWith(ID_PREFIX.service)) return 'service';
  if (id.startsWith(ID_PREFIX.postgres)) return 'postgres';
  if (id.startsWith(ID_PREFIX.keyvalue)) return 'keyvalue';
  return null;
}

export function getResourceName(snapshot: TopologySnapshot, id: string): string | undefined {
  const type = getResourceType(id);
  if (type === 'service') return snapshot.services.find(s => s.id === id)?.name;
  if (type === 'postgres') return snapshot.databases.find(d => d.id === id)?.name;
  if (type === 'keyvalue') return snapshot.keyValueStores.find(k => k.id === id)?.name;
  return undefined;
}
