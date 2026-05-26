import type { TopologySnapshot, ErrorIndicator } from './types.js';
import * as api from './render-api.js';

const TYPE_LABELS: Record<string, string> = {
  static_site: 'static',
  web_service: 'web',
  private_service: 'private',
  background_worker: 'worker',
  cron_job: 'cron',
};

function serviceStatusLabel(s: { suspended: string; type: string }): string {
  if (s.suspended === 'suspended') return 'suspended';
  return 'deployed';
}

export class TopologyCache {
  snapshot: TopologySnapshot | null = null;
  private fetchedAt = 0;
  private ttlMs: number;
  private refreshing: Promise<boolean> | null = null;
  private previousHash = '';
  private lastChanged = false;

  constructor(ttlMs?: number) {
    this.ttlMs = ttlMs ?? Number(process.env.RENDER_CACHE_TTL_MS ?? 30000);
  }

  isStale(): boolean {
    return !this.snapshot || Date.now() - this.fetchedAt > this.ttlMs;
  }

  changed(): boolean {
    return this.lastChanged;
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

  private async _doRefresh(): Promise<boolean> {
    const [services, databases, keyValueStores] = await Promise.all([
      api.fetchServices().catch((err) => { process.stderr.write(`Warning: failed to fetch services: ${err.message}\n`); return []; }),
      api.fetchPostgres().catch((err) => { process.stderr.write(`Warning: failed to fetch postgres: ${err.message}\n`); return []; }),
      api.fetchKeyValue().catch((err) => { process.stderr.write(`Warning: failed to fetch key-value stores: ${err.message}\n`); return []; }),
    ]);

    const envVarCounts = new Map<string, number>();
    const errorIndicators = new Map<string, ErrorIndicator>();

    const windowMinutes = Number(process.env.RENDER_LOG_DEFAULT_WINDOW_MIN ?? 10);
    const startTime = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    const indicatorPromises = services.map(async (svc) => {
      try {
        const logs = await api.fetchServiceLogs(svc.id, {
          startTime,
          severity: 'error',
          limit: 100,
        });
        const count = logs.length;
        errorIndicators.set(svc.id, {
          count,
          label: count > 0 ? `${count} errors in last ${windowMinutes}m` : 'clean',
        });
      } catch {
        errorIndicators.set(svc.id, { count: 0, label: 'unknown' });
      }
    });

    const envVarPromises = services.map(async (svc) => {
      try {
        const vars = await api.fetchEnvVars(svc.id);
        envVarCounts.set(svc.id, vars.length);
      } catch {
        envVarCounts.set(svc.id, 0);
      }
    });

    await Promise.all([...indicatorPromises, ...envVarPromises]);

    this.snapshot = { services, databases, keyValueStores, fetchedAt: Date.now(), envVarCounts, errorIndicators };
    this.fetchedAt = Date.now();

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
    return ids.sort().join('|');
  }

  describe(toolName: string): string {
    const base = BASE_DESCRIPTIONS[toolName];
    if (!base) return toolName;
    if (!this.snapshot) return base + '\n\n(Loading infrastructure state...)';

    const s = this.snapshot;

    switch (toolName) {
      case 'render_deploy':
        return base + '\n\n' + this.formatServicesTable(false);

      case 'render_logs':
        return base + '\n\n' + this.formatLogsTable();

      case 'render_env_vars':
        return base + '\n\n' + this.formatEnvVarsTable();

      case 'render_inspect':
        return base + '\n\n' + this.formatAllResourcesTable();

      case 'render_restart':
        return base + '\n\n' + this.formatServicesTable(false);

      case 'render_run_command':
        return base + '\n\n' + this.formatServicesTable(false);

      default:
        return base;
    }
  }

  resourceIds(filter?: 'services' | 'all'): string[] {
    if (!this.snapshot) return [];
    if (filter === 'services') {
      return this.snapshot.services.map(s => s.id);
    }
    return [
      ...this.snapshot.services.map(s => s.id),
      ...this.snapshot.databases.map(d => d.id),
      ...this.snapshot.keyValueStores.map(k => k.id),
    ];
  }

  private formatServicesTable(includeUrl = true): string {
    if (!this.snapshot || this.snapshot.services.length === 0) {
      return 'No services found. Deploy via render.yaml or the Render Dashboard to get started.';
    }
    const header = 'Services:';
    const lines = this.snapshot.services.map(s => {
      const type = TYPE_LABELS[s.type] ?? s.type;
      const status = serviceStatusLabel(s);
      const url = includeUrl && 'url' in s.serviceDetails && (s.serviceDetails as any).url
        ? ` │ ${(s.serviceDetails as any).url}`
        : '';
      return `${s.id} │ ${s.name} │ ${type} │ ${status}${url}`;
    });
    return header + '\n' + lines.join('\n');
  }

  private formatLogsTable(): string {
    if (!this.snapshot) return '';
    const allEmpty =
      this.snapshot.services.length === 0 &&
      this.snapshot.databases.length === 0 &&
      this.snapshot.keyValueStores.length === 0;
    if (allEmpty) {
      return 'No resources found. Deploy via render.yaml or the Render Dashboard to get started.';
    }
    const header = 'Resources:';
    const lines: string[] = [];
    for (const s of this.snapshot.services) {
      const type = TYPE_LABELS[s.type] ?? s.type;
      const indicator = this.snapshot.errorIndicators.get(s.id)?.label ?? 'unknown';
      lines.push(`${s.id} │ ${s.name} │ ${type} │ ${indicator}`);
    }
    for (const d of this.snapshot.databases) {
      lines.push(`${d.id} │ ${d.name} │ postgres │ clean`);
    }
    for (const k of this.snapshot.keyValueStores) {
      lines.push(`${k.id} │ ${k.name} │ redis │ clean`);
    }
    return header + '\n' + lines.join('\n');
  }

  private formatEnvVarsTable(): string {
    if (!this.snapshot || this.snapshot.services.length === 0) {
      return 'No services found. Deploy via render.yaml or the Render Dashboard to get started.';
    }
    const header = 'Services:';
    const lines = this.snapshot.services.map(s => {
      const count = this.snapshot!.envVarCounts.get(s.id) ?? 0;
      return `${s.id} │ ${s.name} │ ${count} env vars`;
    });
    return header + '\n' + lines.join('\n');
  }

  private formatAllResourcesTable(): string {
    if (!this.snapshot) return '';
    const lines: string[] = [];
    for (const s of this.snapshot.services) {
      const type = TYPE_LABELS[s.type] ?? s.type;
      const status = serviceStatusLabel(s);
      lines.push(`${s.id} │ ${s.name} │ ${type} │ ${status}`);
    }
    for (const d of this.snapshot.databases) {
      lines.push(`${d.id} │ ${d.name} │ postgres │ ${d.status}`);
    }
    for (const k of this.snapshot.keyValueStores) {
      lines.push(`${k.id} │ ${k.name} │ redis │ ${k.status}`);
    }
    if (lines.length === 0) {
      return 'No resources found. Deploy via render.yaml or the Render Dashboard to get started.';
    }
    return 'Resources:\n' + lines.join('\n');
  }
}

const BASE_DESCRIPTIONS: Record<string, string> = {
  render_deploy:
    'Trigger a deploy on a Render service.',
  render_logs:
    'Retrieve and analyze logs from a Render resource. Returns a processed summary by default (deduplicated errors, patterns, correlations). Pass raw: true for unprocessed lines.',
  render_env_vars:
    'Read or set environment variables on a Render service.',
  render_inspect:
    'Get detailed information about any Render resource — plan, region, last deploy, crash details, connection info.',
  render_restart:
    'Restart a running service without triggering a full deploy (no rebuild).',
  render_run_command:
    'Execute a one-off command in a service\'s environment (e.g., migrations, seed scripts).',
};
