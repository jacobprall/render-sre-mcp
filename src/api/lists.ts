import type { Postgres, Service } from '../types/render-api.js';
import { paginateAll } from './http.js';
import { fetchKeyValue } from './keyValue.js';

export async function fetchServices(): Promise<Service[]> {
  return paginateAll<Service>('/services', 'service');
}

export async function fetchPostgres(): Promise<Postgres[]> {
  return paginateAll<Postgres>('/postgres', 'postgres');
}

export { fetchKeyValue };
