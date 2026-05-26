import { RenderClient, RenderNetworkError, RenderTimeoutError, RenderAuthError, RenderRateLimitError } from 'render-api';
import type { Service, Postgres, KeyValue, Deploy, EnvVar, Job } from 'render-api';

export { RenderNetworkError, RenderTimeoutError, RenderAuthError, RenderRateLimitError };

export interface LogEntry {
  id: string;
  message: string;
  timestamp: string;
  labels: Array<{ name: string; value: string }>;
}

let client: RenderClient | null = null;
let cachedOwnerId: string | null = null;

function getApiKey(): string {
  const key = process.env.RENDER_API_KEY;
  if (!key) {
    throw new Error(
      'RENDER_API_KEY is required. Set it as an environment variable.'
    );
  }
  return key;
}

export function getClient(): RenderClient {
  if (!client) {
    client = new RenderClient({ apiKey: getApiKey() });
  }
  return client;
}

async function getOwnerId(): Promise<string> {
  if (cachedOwnerId) return cachedOwnerId;
  const key = getApiKey();
  const resp = await fetch('https://api.render.com/v1/owners?limit=1', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) throw new Error(`Failed to fetch owner: ${resp.status}`);
  const data = await resp.json() as Array<{ owner: { id: string } }>;
  if (!data.length) throw new Error('No owner found for this API key');
  cachedOwnerId = data[0].owner.id;
  return cachedOwnerId;
}

export function resetClient(): void {
  client = null;
  cachedOwnerId = null;
}

export async function fetchServices(): Promise<Service[]> {
  const c = getClient();
  const services: Service[] = [];
  for await (const service of c.services.listAll({ limit: 100 })) {
    services.push(service);
  }
  return services;
}

export async function fetchPostgres(): Promise<Postgres[]> {
  const c = getClient();
  const dbs: Postgres[] = [];
  for await (const db of c.postgres.listAll({ limit: 100 })) {
    dbs.push(db);
  }
  return dbs;
}

export async function fetchKeyValue(): Promise<KeyValue[]> {
  const c = getClient();
  const stores: KeyValue[] = [];
  for await (const kv of c.keyValue.listAll({ limit: 100 })) {
    stores.push(kv);
  }
  return stores;
}

export async function fetchServiceLogs(
  resourceId: string,
  options?: {
    startTime?: string;
    endTime?: string;
    severity?: 'debug' | 'info' | 'warn' | 'error';
    limit?: number;
    direction?: 'forward' | 'backward';
  }
): Promise<LogEntry[]> {
  const key = getApiKey();
  const ownerId = await getOwnerId();
  const params = new URLSearchParams();
  params.set('ownerId', ownerId);
  params.set('resource', resourceId);
  params.set('limit', String(options?.limit ?? 500));
  params.set('direction', options?.direction ?? 'backward');
  if (options?.startTime) params.set('startTime', options.startTime);
  if (options?.endTime) params.set('endTime', options.endTime);
  if (options?.severity) params.set('severity', options.severity);

  const resp = await fetch(`https://api.render.com/v1/logs?${params}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) {
    const body = await resp.text();
    const truncated = body.length > 200 ? body.slice(0, 200) + '…' : body;
    throw new Error(`Logs API error (${resp.status}): ${truncated}`);
  }
  const data = await resp.json() as { logs: LogEntry[] };
  return data.logs ?? [];
}

export async function fetchDeploys(
  serviceId: string,
  limit = 5
): Promise<Deploy[]> {
  const c = getClient();
  const { items } = await c.services.deploys.list(serviceId, { limit });
  return items;
}

export async function fetchDeployHistory(
  serviceId: string,
  limit = 10
): Promise<Deploy[]> {
  return fetchDeploys(serviceId, limit);
}

export interface MetricPoint {
  timestamp: string;
  value: number;
}

async function fetchMetricSeries(
  resourceId: string,
  fetcher: (params: {
    resourceIds: string[];
    startTime?: string;
    endTime?: string;
  }) => Promise<{ series: Array<{ values: MetricPoint[] }> }>,
  window: { startTime: string; endTime: string }
): Promise<MetricPoint[]> {
  try {
    const c = getClient();
    const resp = await fetcher.call(c.metrics, {
      resourceIds: [resourceId],
      startTime: window.startTime,
      endTime: window.endTime,
    });
    const points: MetricPoint[] = [];
    for (const s of resp.series ?? []) {
      for (const v of s.values ?? []) points.push(v);
    }
    return points;
  } catch {
    return [];
  }
}

export async function fetchMetricsBundle(
  resourceId: string,
  window: { start: Date; end: Date }
) {
  const c = getClient();
  const range = {
    startTime: window.start.toISOString(),
    endTime: window.end.toISOString(),
  };
  const isPostgres = resourceId.startsWith('dpg-');
  const isKv = resourceId.startsWith('red-');

  const [memory, memoryLimit, cpu, activeConnections] = await Promise.all([
    fetchMetricSeries(resourceId, c.metrics.memory.bind(c.metrics), range),
    fetchMetricSeries(resourceId, c.metrics.memoryLimit.bind(c.metrics), range),
    isPostgres || isKv
      ? Promise.resolve([])
      : fetchMetricSeries(resourceId, c.metrics.cpu.bind(c.metrics), range),
    isPostgres || isKv
      ? fetchMetricSeries(resourceId, c.metrics.activeConnections.bind(c.metrics), range)
      : Promise.resolve([]),
  ]);

  let httpLatencyP95Peak: number | undefined;
  if (!isPostgres && !isKv) {
    try {
      const latency = await c.metrics.httpLatency({
        resourceIds: [resourceId],
        ...range,
      });
      const vals = latency.series?.flatMap(s => s.values.map(v => v.value)) ?? [];
      if (vals.length) httpLatencyP95Peak = Math.max(...vals);
    } catch { /* optional */ }
  }

  return { memory, memoryLimit, cpu, activeConnections, httpLatencyP95Peak };
}

export async function patchService(
  serviceId: string,
  patch: Record<string, unknown>
): Promise<Service> {
  const c = getClient();
  return c.services.update(serviceId, patch as Parameters<typeof c.services.update>[1]);
}

export async function fetchEnvVars(
  serviceId: string
): Promise<EnvVar[]> {
  const c = getClient();
  const vars: EnvVar[] = [];
  for await (const v of c.services.envVars.listAll(serviceId, { limit: 100 })) {
    vars.push(v);
  }
  return vars;
}

export async function triggerDeploy(
  serviceId: string,
  opts?: { clearCache?: boolean }
): Promise<Deploy> {
  const c = getClient();
  return c.services.deploys.create(serviceId, opts?.clearCache ? { clearCache: 'clear' } : undefined);
}

export async function restartService(
  serviceId: string
): Promise<void> {
  const c = getClient();
  await c.services.restart(serviceId);
}

export async function setEnvVars(
  serviceId: string,
  vars: Record<string, string>
): Promise<EnvVar[]> {
  const c = getClient();
  const existing = await fetchEnvVars(serviceId);

  const merged = existing.map(ev => {
    if (vars[ev.key] !== undefined) {
      return { key: ev.key, value: vars[ev.key] };
    }
    return { key: ev.key, value: ev.value };
  });

  for (const [key, value] of Object.entries(vars)) {
    if (!merged.some(e => e.key === key)) {
      merged.push({ key, value });
    }
  }

  return c.services.envVars.update(serviceId, merged);
}

export async function createJob(
  serviceId: string,
  command: string
): Promise<Job> {
  const c = getClient();
  return c.services.jobs.create(serviceId, { startCommand: command });
}

export async function retrieveJob(
  serviceId: string,
  jobId: string
): Promise<Job> {
  const c = getClient();
  return c.services.jobs.retrieve(serviceId, jobId);
}

export async function retrieveService(
  serviceId: string
): Promise<Service> {
  const c = getClient();
  return c.services.retrieve(serviceId);
}

export async function retrievePostgres(
  postgresId: string
): Promise<Postgres> {
  const c = getClient();
  return c.postgres.retrieve(postgresId);
}

export async function retrieveKeyValue(
  keyValueId: string
): Promise<KeyValue> {
  const c = getClient();
  return c.keyValue.retrieve(keyValueId);
}

export async function getKeyValueConnectionInfo(
  keyValueId: string
) {
  const c = getClient();
  return c.keyValue.connectionInfo(keyValueId);
}
