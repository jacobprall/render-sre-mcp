import { loadConfig } from '../../config.js';
import type { HotResourceTracker } from '../../hot-resources.js';
import * as api from '../../render-api.js';
import type { TopologySnapshot } from '../../types/topology.js';
import { describeTool } from './descriptions.js';
import { enrichDeployHints } from './enrich.js';

export class TopologyCache {
  snapshot: TopologySnapshot | null = null;
  private fetchedAt = 0;
  private ttlMs: number;
  private refreshing: Promise<boolean> | null = null;
  private previousHash = '';
  private lastChanged = false;
  private lastRefreshOk = false;
  private readonly hotTracker: HotResourceTracker;

  constructor(hotTracker: HotResourceTracker, ttlMs?: number) {
    this.hotTracker = hotTracker;
    const config = loadConfig();
    this.ttlMs = ttlMs ?? config.cacheTtlMs;
  }

  isStale(): boolean {
    return !this.snapshot || Date.now() - this.fetchedAt > this.ttlMs;
  }

  async ensureFresh(): Promise<void> {
    if (!this.isStale()) return;
    await this.refresh();
  }

  async refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;

    this.refreshing = this._doRefresh();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  describe(toolName: string): string {
    return describeTool(toolName, {
      snapshot: this.snapshot,
      lastRefreshOk: this.lastRefreshOk,
    });
  }

  private async _doRefresh(): Promise<boolean> {
    const [services, databases, keyValueStores] = await Promise.all([
      api.fetchServices().catch((err) => {
        process.stderr.write(`Warning: failed to fetch services: ${err.message}\n`);
        return null;
      }),
      api.fetchPostgres().catch((err) => {
        process.stderr.write(`Warning: failed to fetch postgres: ${err.message}\n`);
        return null;
      }),
      api.fetchKeyValue().catch((err) => {
        process.stderr.write(`Warning: failed to fetch key-value stores: ${err.message}\n`);
        return null;
      }),
    ]);

    if (services === null && databases === null && keyValueStores === null) {
      this.lastRefreshOk = false;
      return false;
    }

    const partialSnapshot: TopologySnapshot = {
      services: services ?? this.snapshot?.services ?? [],
      databases: databases ?? this.snapshot?.databases ?? [],
      keyValueStores: keyValueStores ?? this.snapshot?.keyValueStores ?? [],
      fetchedAt: Date.now(),
      envVarCounts: new Map(),
      errorIndicators: new Map(),
      deployHints: new Map(),
      pressureHints: new Map(),
    };

    partialSnapshot.deployHints = await enrichDeployHints(partialSnapshot, this.hotTracker);

    this.snapshot = partialSnapshot;
    this.fetchedAt = Date.now();
    this.lastRefreshOk = true;

    const hash = this.computeHash();
    this.lastChanged = hash !== this.previousHash;
    this.previousHash = hash;

    return this.lastChanged;
  }

  private computeHash(): string {
    if (!this.snapshot) return '';
    const ids = [
      ...this.snapshot.services.map(s => `${s.id}:${s.suspended}:${s.updatedAt}`),
      ...this.snapshot.databases.map(d => `${d.id}:${d.status}:${d.updatedAt}`),
      ...this.snapshot.keyValueStores.map(k => `${k.id}:${k.status}:${k.updatedAt}`),
    ];
    for (const [id, h] of this.snapshot.deployHints) {
      ids.push(`deploy:${id}:${h.status}:${h.ageLabel}`);
    }
    return ids.sort().join('|');
  }
}
