import type { TopologySnapshot } from '../../src/types/topology.js';
import type { LogEntry } from '../../src/render-api.js';

export function makeSnapshot(overrides: Partial<TopologySnapshot> = {}): TopologySnapshot {
  return {
    services: [
      {
        id: 'srv-abc123',
        name: 'api',
        type: 'web_service',
        suspended: 'not_suspended',
        branch: 'main',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-06-01T00:00:00Z',
        serviceDetails: { plan: 'starter', region: 'oregon' },
      } as TopologySnapshot['services'][number],
    ],
    databases: [
      {
        id: 'dpg-db1',
        name: 'main-db',
        status: 'available',
        version: '16',
        plan: 'starter',
        region: 'oregon',
        databaseName: 'db',
        databaseUser: 'user',
        highAvailabilityEnabled: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-06-01T00:00:00Z',
      } as TopologySnapshot['databases'][number],
    ],
    keyValueStores: [
      {
        id: 'red-kv1',
        name: 'cache',
        status: 'available',
        plan: 'starter',
        region: 'oregon',
        maxmemoryPolicy: 'allkeys-lru',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-06-01T00:00:00Z',
      } as TopologySnapshot['keyValueStores'][number],
    ],
    fetchedAt: Date.now(),
    envVarCounts: new Map([['srv-abc123', 3]]),
    errorIndicators: new Map([['srv-abc123', { count: 2, label: '2 errors in last 10m' }]]),
    deployHints: new Map([
      ['srv-abc123', { ageLabel: '5m ago', status: 'live', deployId: 'dep-1' }],
    ]),
    pressureHints: new Map([['srv-abc123', { memoryPct: 82 }]]),
    ...overrides,
  };
}

export function logEntry(
  message: string,
  opts?: { timestamp?: string; level?: string }
): LogEntry {
  const labels = opts?.level ? [{ name: 'level', value: opts.level }] : [];
  return {
    id: `log-${Math.random().toString(36).slice(2, 9)}`,
    message,
    timestamp: opts?.timestamp ?? new Date().toISOString(),
    labels,
  };
}
