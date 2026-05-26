import type { EnvVar } from 'render-api';
import { getClient } from './client.js';

export async function fetchEnvVars(serviceId: string): Promise<EnvVar[]> {
  const c = getClient();
  const vars: EnvVar[] = [];
  for await (const v of c.services.envVars.listAll(serviceId, { limit: 100 })) {
    vars.push(v);
  }
  return vars;
}
