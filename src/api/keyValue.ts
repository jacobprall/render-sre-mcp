import type { KeyValue } from '../types/render-api.js';
import { paginateAll, renderGet } from './http.js';

/** Defaults for fields the API sometimes omits on list/retrieve. */
export function normalizeKeyValue(raw: Record<string, unknown>): KeyValue {
  const ipAllowList = raw.ipAllowList;
  return {
    ...raw,
    id: String(raw.id),
    name: String(raw.name),
    status: String(raw.status ?? 'unknown'),
    maxmemoryPolicy: (raw.maxmemoryPolicy as KeyValue['maxmemoryPolicy']) ?? 'noeviction',
    suspended: (raw.suspended as KeyValue['suspended']) ?? 'not_suspended',
    suspenders: Array.isArray(raw.suspenders) ? (raw.suspenders as string[]) : [],
    ipAllowList:
      ipAllowList == null
        ? undefined
        : Array.isArray(ipAllowList)
          ? (ipAllowList as unknown[])
          : undefined,
    owner: (raw.owner as KeyValue['owner']) ?? { id: 'unknown', name: 'unknown' },
    dashboardUrl: typeof raw.dashboardUrl === 'string' ? raw.dashboardUrl : '',
  };
}

export async function fetchKeyValue(): Promise<KeyValue[]> {
  const rows = await paginateAll<Record<string, unknown>>('/key-value', 'keyValue');
  return rows.map(normalizeKeyValue);
}

export async function retrieveKeyValue(keyValueId: string): Promise<KeyValue> {
  const data = await renderGet<Record<string, unknown>>(`/key-value/${keyValueId}`);
  return normalizeKeyValue(data);
}

export async function getKeyValueConnectionInfo(
  keyValueId: string
): Promise<Record<string, unknown>> {
  return renderGet<Record<string, unknown>>(`/key-value/${keyValueId}/connection-info`);
}
