import type { TopologySnapshot, ErrorIndicator, DeployHint, PressureHint } from './types.js';
import type { HotResourceTracker } from './hot-resources.js';
import { computeHotResourceIds, computeHotServiceIds } from './hot-resources.js';
import { loadConfig } from './config.js';
import * as api from './render-api.js';

const MAX_CONCURRENCY = 8;

const TYPE_LABELS: Record<string, string> = {
  static_site: 'static',
  web_service: 'web',
  private_service: 'private',
  background_worker: 'worker',
  cron_job: 'cron',
};

function serviceStatusLabel(s: { suspended: string }): string {
  if (s.suspended === 'suspended') return 'suspended';
  return 'deployed';
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function next(): Promise<void> {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

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
      api.fetchServices().catch((err) => { process.stderr.write(`Warning: failed to fetch services: ${err.message}\n`); return null; }),
      api.fetchPostgres().catch((err) => { process.stderr.write(`Warning: failed to fetch postgres: ${err.message}\n`); return null; }),
      api.fetchKeyValue().catch((err) => { process.stderr.write(`Warning: failed to fetch key-value stores: ${err.message}\n`); return null; }),
    ]);

    if (services === null && databases === null && keyValueStores === null) {
      this.lastRefreshOk = false;
      return false;
    }

    const svcList = services ?? this.snapshot?.services ?? [];
    const dbList = databases ?? this.snapshot?.databases ?? [];
    const kvList = keyValueStores ?? this.snapshot?.keyValueStores ?? [];

    const config = loadConfig();
    const windowMinutes = config.logDefaultWindowMin;
    const startTime = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    const envVarCounts = new Map<string, number>();
    const errorIndicators = new Map<string, ErrorIndicator>();

    const indicatorTasks = svcList.map(svc => async () => {
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

    const envVarTasks = svcList.map(svc => async () => {
      try {
        const vars = await api.fetchEnvVars(svc.id);
        envVarCounts.set(svc.id, vars.length);
      } catch {
        envVarCounts.set(svc.id, 0);
      }
    });

    await runWithConcurrency([...indicatorTasks, ...envVarTasks], MAX_CONCURRENCY);

    const partialSnapshot: TopologySnapshot = {
      services: svcList,
      databases: dbList,
      keyValueStores: kvList,
      fetchedAt: Date.now(),
      envVarCounts,
      errorIndicators,
      deployHints: new Map(),
      pressureHints: new Map(),
    };

    const hotServices = computeHotServiceIds(partialSnapshot, this.hotTracker);
    const hotResources = computeHotResourceIds(partialSnapshot, this.hotTracker);

    const deployHints = new Map<string, DeployHint>();
    const pressureHints = new Map<string, PressureHint>();

    const deployTasks = [...hotServices].map(serviceId => async () => {
      try {
        const deploys = await api.fetchDeployHistory(serviceId, 1);
        const d = deploys[0];
        if (!d) return;
        const liveAt = d.finishedAt ?? d.updatedAt ?? d.createdAt ?? '';
        deployHints.set(serviceId, {
          ageLabel: liveAt ? formatAge(liveAt) : '?',
          status: d.status ?? 'unknown',
          deployId: d.id,
        });
      } catch { /* omit hint */ }
    });

    const pressureTasks = [...hotResources].map(resourceId => async () => {
      try {
        const end = new Date();
        const start = new Date(end.getTime() - 15 * 60 * 1000);
        const bundle = await api.fetchMetricsBundle(resourceId, { start, end });
        const hint: PressureHint = {};

        const memPeak = bundle.memory?.length
          ? Math.max(...bundle.memory.map(p => p.value))
          : undefined;
        const memLimit = bundle.memoryLimit?.length
          ? Math.max(...bundle.memoryLimit.map(p => p.value))
          : undefined;
        if (memPeak != null && memLimit != null && memLimit > 0) {
          const pct = Math.round((memPeak / memLimit) * 100);
          if (pct >= 75) hint.memoryPct = pct;
        }
        if (bundle.httpLatencyP95Peak != null && bundle.httpLatencyP95Peak > 1500) {
          hint.p95LatencyMs = Math.round(bundle.httpLatencyP95Peak);
        }

        if (hint.memoryPct != null || hint.p95LatencyMs != null) {
          pressureHints.set(resourceId, hint);
        }
      } catch { /* omit */ }
    });

    await runWithConcurrency([...deployTasks, ...pressureTasks], MAX_CONCURRENCY);

    partialSnapshot.deployHints = deployHints;
    partialSnapshot.pressureHints = pressureHints;

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
    for (const [id, p] of this.snapshot.pressureHints) {
      ids.push(`pressure:${id}:${p.memoryPct ?? ''}:${p.p95LatencyMs ?? ''}`);
    }
    return ids.sort().join('|');
  }

  describe(toolName: string): string {
    const base = BASE_DESCRIPTIONS[toolName];
    if (!base) return toolName;
    if (!this.snapshot) {
      if (!this.lastRefreshOk) return base + '\n\n(Unable to reach Render API — will retry on next call.)';
      return base + '\n\n(Loading infrastructure state...)';
    }

    switch (toolName) {
      case 'render_deploy':
      case 'render_restart':
      case 'render_run_command':
      case 'render_deploys':
      case 'render_configure':
        return base + '\n\n' + this.formatServicesTable(false);

      case 'render_logs':
      case 'render_diagnose':
        return base + '\n\n' + this.formatLogsTable();

      case 'render_env_vars':
        return base + '\n\n' + this.formatEnvVarsTable();

      case 'render_inspect':
      case 'render_metrics':
        return base + '\n\n' + this.formatAllResourcesTable();

      default:
        return base;
    }
  }

  resourceIds(filter?: 'services' | 'postgres' | 'all'): string[] {
    if (!this.snapshot) return [];
    if (filter === 'services') {
      return this.snapshot.services.map(s => s.id);
    }
    if (filter === 'postgres') {
      return this.snapshot.databases.map(d => d.id);
    }
    return [
      ...this.snapshot.services.map(s => s.id),
      ...this.snapshot.databases.map(d => d.id),
      ...this.snapshot.keyValueStores.map(k => k.id),
    ];
  }

  private pressureLabel(resourceId: string): string {
    const hint = this.snapshot?.pressureHints.get(resourceId);
    if (!hint) return '';
    const parts: string[] = [];
    if (hint.memoryPct != null) parts.push(`mem ~${hint.memoryPct}%`);
    if (hint.p95LatencyMs != null) parts.push(`p95 ${hint.p95LatencyMs}ms`);
    return parts.join(', ');
  }

  private serviceLineExtras(serviceId: string): string {
    if (!this.snapshot) return '';
    const parts: string[] = [];
    const deploy = this.snapshot.deployHints.get(serviceId);
    if (deploy) parts.push(`deploy ${deploy.ageLabel} · ${deploy.status}`);
    const pressure = this.pressureLabel(serviceId);
    if (pressure) parts.push(pressure);
    return parts.length ? ' │ ' + parts.join(' │ ') : '';
  }

  private formatServicesTable(includeUrl = true): string {
    if (!this.snapshot || this.snapshot.services.length === 0) {
      return 'No services found. Deploy via render.yaml or the Render Dashboard to get started.';
    }
    const header = 'Services:';
    const lines = this.snapshot.services.map(s => {
      const type = TYPE_LABELS[s.type] ?? s.type;
      const status = serviceStatusLabel(s);
      const url = includeUrl && 'url' in s.serviceDetails && (s.serviceDetails as { url?: string }).url
        ? ` │ ${(s.serviceDetails as { url?: string }).url}`
        : '';
      return `${s.id} │ ${s.name} │ ${type} │ ${status}${url}${this.serviceLineExtras(s.id)}`;
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
      lines.push(`${s.id} │ ${s.name} │ ${type} │ ${indicator}${this.serviceLineExtras(s.id)}`);
    }
    for (const d of this.snapshot.databases) {
      const pressure = this.pressureLabel(d.id);
      lines.push(`${d.id} │ ${d.name} │ postgres │ ${d.status}${pressure ? ` │ ${pressure}` : ''}`);
    }
    for (const k of this.snapshot.keyValueStores) {
      const pressure = this.pressureLabel(k.id);
      lines.push(`${k.id} │ ${k.name} │ redis │ ${k.status}${pressure ? ` │ ${pressure}` : ''}`);
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
      lines.push(`${s.id} │ ${s.name} │ ${type} │ ${status}${this.serviceLineExtras(s.id)}`);
    }
    for (const d of this.snapshot.databases) {
      const pressure = this.pressureLabel(d.id);
      lines.push(`${d.id} │ ${d.name} │ postgres │ ${d.status}${pressure ? ` │ ${pressure}` : ''}`);
    }
    for (const k of this.snapshot.keyValueStores) {
      const pressure = this.pressureLabel(k.id);
      lines.push(`${k.id} │ ${k.name} │ redis │ ${k.status}${pressure ? ` │ ${pressure}` : ''}`);
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
    "Execute a one-off command in a service's environment (e.g., migrations, seed scripts).",
  render_deploys:
    'Recent deployment history for a service (timeline summary, regression flags within 30m of live).',
  render_metrics:
    'Performance metrics summary (peaks vs limits, trends). Pass raw: true for JSON series.',
  render_diagnose:
    'One-shot incident brief: logs + deploy timeline + metrics. Suggests next tools.',
  render_configure:
    'Update service platform config (not env vars). Tier 1: safe changes immediate. Tier 2: requires confirmed:true AND user approval in chat first.',
};
