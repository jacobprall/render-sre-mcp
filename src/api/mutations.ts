import type { Deploy, EnvVar, Job, Postgres, Service } from '../types/render-api.js';
import { fetchEnvVars, updateEnvVars } from './env-vars.js';
import { paginateAll, renderGet, renderPatch, renderPost } from './http.js';
import { retrieveKeyValue, getKeyValueConnectionInfo } from './keyValue.js';

export async function fetchDeploys(serviceId: string, limit = 5): Promise<Deploy[]> {
  return paginateAll<Deploy>(`/services/${serviceId}/deploys`, 'deploy', undefined, limit);
}

export async function patchService(
  serviceId: string,
  patch: Record<string, unknown>
): Promise<Service> {
  return renderPatch<Service>(`/services/${serviceId}`, patch);
}

export async function triggerDeploy(
  serviceId: string,
  opts?: { clearCache?: boolean }
): Promise<Deploy> {
  const body = opts?.clearCache ? { clearCache: 'clear' } : undefined;
  return renderPost<Deploy>(`/services/${serviceId}/deploys`, body);
}

export async function restartService(serviceId: string): Promise<void> {
  await renderPost(`/services/${serviceId}/restart`);
}

export async function setEnvVars(
  serviceId: string,
  vars: Record<string, string>
): Promise<EnvVar[]> {
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

  return updateEnvVars(serviceId, merged);
}

export async function createJob(serviceId: string, command: string): Promise<Job> {
  return renderPost<Job>(`/services/${serviceId}/jobs`, { startCommand: command });
}

export async function retrieveJob(serviceId: string, jobId: string): Promise<Job> {
  return renderGet<Job>(`/services/${serviceId}/jobs/${jobId}`);
}

export async function retrieveService(serviceId: string): Promise<Service> {
  return renderGet<Service>(`/services/${serviceId}`);
}

export async function retrievePostgres(postgresId: string): Promise<Postgres> {
  return renderGet<Postgres>(`/postgres/${postgresId}`);
}

export { retrieveKeyValue, getKeyValueConnectionInfo };
