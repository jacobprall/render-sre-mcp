import type { Service, Postgres, KeyValue } from 'render-api';
import { getClient } from './client.js';

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
