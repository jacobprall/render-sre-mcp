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
let cachedApiKey: string | null = null;
let cachedOwnerId: string | null = null;

export function getClient(apiKey?: string): RenderClient {
  const key = apiKey ?? process.env.RENDER_API_KEY;
  if (!key) {
    throw new Error(
      'RENDER_API_KEY is required. Set it as an environment variable or pass it in the Authorization header.'
    );
  }
  cachedApiKey = key;
  if (!client) {
    client = new RenderClient({ apiKey: key });
  }
  return client;
}

async function getOwnerId(apiKey?: string): Promise<string> {
  if (cachedOwnerId) return cachedOwnerId;
  const key = apiKey ?? cachedApiKey ?? process.env.RENDER_API_KEY;
  if (!key) throw new Error('RENDER_API_KEY is required');
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
}

export async function fetchServices(apiKey?: string): Promise<Service[]> {
  const c = getClient(apiKey);
  const services: Service[] = [];
  for await (const service of c.services.listAll({ limit: 100 })) {
    services.push(service);
  }
  return services;
}

export async function fetchPostgres(apiKey?: string): Promise<Postgres[]> {
  const c = getClient(apiKey);
  const dbs: Postgres[] = [];
  for await (const db of c.postgres.listAll({ limit: 100 })) {
    dbs.push(db);
  }
  return dbs;
}

export async function fetchKeyValue(apiKey?: string): Promise<KeyValue[]> {
  const c = getClient(apiKey);
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
  },
  apiKey?: string
): Promise<LogEntry[]> {
  const key = apiKey ?? cachedApiKey ?? process.env.RENDER_API_KEY;
  if (!key) throw new Error('RENDER_API_KEY is required');
  const ownerId = await getOwnerId(apiKey);
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
    throw new Error(`Logs API error (${resp.status}): ${body}`);
  }
  const data = await resp.json() as { logs: LogEntry[] };
  return data.logs ?? [];
}

export async function fetchDeploys(
  serviceId: string,
  limit = 5,
  apiKey?: string
): Promise<Deploy[]> {
  const c = getClient(apiKey);
  const { items } = await c.services.deploys.list(serviceId, { limit });
  return items;
}

export async function fetchEnvVars(
  serviceId: string,
  apiKey?: string
): Promise<EnvVar[]> {
  const c = getClient(apiKey);
  const vars: EnvVar[] = [];
  for await (const v of c.services.envVars.listAll(serviceId, { limit: 100 })) {
    vars.push(v);
  }
  return vars;
}

export async function triggerDeploy(
  serviceId: string,
  opts?: { clearCache?: boolean },
  apiKey?: string
): Promise<Deploy> {
  const c = getClient(apiKey);
  return c.services.deploys.create(serviceId, opts?.clearCache ? { clearCache: 'clear' } : undefined);
}

export async function restartService(
  serviceId: string,
  apiKey?: string
): Promise<void> {
  const c = getClient(apiKey);
  await c.services.restart(serviceId);
}

export async function setEnvVars(
  serviceId: string,
  vars: Record<string, string>,
  apiKey?: string
): Promise<EnvVar[]> {
  const c = getClient(apiKey);
  const existing = await fetchEnvVars(serviceId, apiKey);
  const merged = existing.map(ev => ({
    key: ev.key,
    value: vars[ev.key] !== undefined ? vars[ev.key] : ev.value,
  }));
  for (const [key, value] of Object.entries(vars)) {
    if (!merged.some(e => e.key === key)) {
      merged.push({ key, value });
    }
  }
  return c.services.envVars.update(serviceId, merged);
}

export async function createJob(
  serviceId: string,
  command: string,
  apiKey?: string
): Promise<Job> {
  const c = getClient(apiKey);
  return c.services.jobs.create(serviceId, { startCommand: command });
}

export async function retrieveJob(
  serviceId: string,
  jobId: string,
  apiKey?: string
): Promise<Job> {
  const c = getClient(apiKey);
  return c.services.jobs.retrieve(serviceId, jobId);
}

export async function retrieveService(
  serviceId: string,
  apiKey?: string
): Promise<Service> {
  const c = getClient(apiKey);
  return c.services.retrieve(serviceId);
}

export async function retrievePostgres(
  postgresId: string,
  apiKey?: string
): Promise<Postgres> {
  const c = getClient(apiKey);
  return c.postgres.retrieve(postgresId);
}

export async function retrieveKeyValue(
  keyValueId: string,
  apiKey?: string
): Promise<KeyValue> {
  const c = getClient(apiKey);
  return c.keyValue.retrieve(keyValueId);
}

export async function getKeyValueConnectionInfo(
  keyValueId: string,
  apiKey?: string
) {
  const c = getClient(apiKey);
  return c.keyValue.connectionInfo(keyValueId);
}
