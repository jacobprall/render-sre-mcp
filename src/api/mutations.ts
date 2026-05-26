import type { Service, Deploy, EnvVar, Job } from 'render-api';
import { getClient } from './client.js';
import { fetchEnvVars } from './env-vars.js';

export async function fetchDeploys(serviceId: string, limit = 5): Promise<Deploy[]> {
  const c = getClient();
  const { items } = await c.services.deploys.list(serviceId, { limit });
  return items;
}

export async function patchService(
  serviceId: string,
  patch: Record<string, unknown>
): Promise<Service> {
  const c = getClient();
  return c.services.update(serviceId, patch as Parameters<typeof c.services.update>[1]);
}

export async function triggerDeploy(
  serviceId: string,
  opts?: { clearCache?: boolean }
): Promise<Deploy> {
  const c = getClient();
  return c.services.deploys.create(serviceId, opts?.clearCache ? { clearCache: 'clear' } : undefined);
}

export async function restartService(serviceId: string): Promise<void> {
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

export async function createJob(serviceId: string, command: string): Promise<Job> {
  const c = getClient();
  return c.services.jobs.create(serviceId, { startCommand: command });
}

export async function retrieveJob(serviceId: string, jobId: string): Promise<Job> {
  const c = getClient();
  return c.services.jobs.retrieve(serviceId, jobId);
}

export async function retrieveService(serviceId: string): Promise<Service> {
  const c = getClient();
  return c.services.retrieve(serviceId);
}

export async function retrievePostgres(postgresId: string) {
  const c = getClient();
  return c.postgres.retrieve(postgresId);
}

export async function retrieveKeyValue(keyValueId: string) {
  const c = getClient();
  return c.keyValue.retrieve(keyValueId);
}

export async function getKeyValueConnectionInfo(keyValueId: string) {
  const c = getClient();
  return c.keyValue.connectionInfo(keyValueId);
}
