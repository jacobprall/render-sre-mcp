import type { EnvVar } from '../types/render-api.js';
import { paginateAll, renderPut } from './http.js';

export async function fetchEnvVars(serviceId: string): Promise<EnvVar[]> {
  return paginateAll<EnvVar>(`/services/${serviceId}/env-vars`, 'envVar');
}

export async function updateEnvVars(serviceId: string, envVars: EnvVar[]): Promise<EnvVar[]> {
  const rows = await renderPut<Array<{ envVar: EnvVar }>>(
    `/services/${serviceId}/env-vars`,
    envVars
  );
  if (!Array.isArray(rows)) return envVars;
  return rows.map(r => r.envVar ?? (r as unknown as EnvVar));
}
