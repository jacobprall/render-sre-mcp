import type { Service, Postgres, KeyValue, Deploy, Job, EnvVar } from 'render-api';
import type { LogEntry } from './render-api.js';

export type { Service, Postgres, KeyValue, Deploy, Job, EnvVar, LogEntry };

export interface TopologySnapshot {
  services: Service[];
  databases: Postgres[];
  keyValueStores: KeyValue[];
  fetchedAt: number;
  envVarCounts: Map<string, number>;
  errorIndicators: Map<string, ErrorIndicator>;
}

export interface ErrorIndicator {
  count: number;
  label: string;
}

export type ResourceType = 'service' | 'postgres' | 'keyvalue';

export function getResourceType(id: string): ResourceType {
  if (id.startsWith('srv-')) return 'service';
  if (id.startsWith('dpg-')) return 'postgres';
  if (id.startsWith('red-')) return 'keyvalue';
  throw new Error(`Unknown resource ID prefix: ${id}`);
}

export function getResourceName(snapshot: TopologySnapshot, id: string): string | undefined {
  const type = getResourceType(id);
  if (type === 'service') return snapshot.services.find(s => s.id === id)?.name;
  if (type === 'postgres') return snapshot.databases.find(d => d.id === id)?.name;
  if (type === 'keyvalue') return snapshot.keyValueStores.find(k => k.id === id)?.name;
  return undefined;
}

export interface LogSummary {
  resourceId: string;
  resourceName: string;
  window: { start: Date; end: Date };
  patterns: LogPattern[];
  requestSummary: RequestSummary | null;
  signals: string[];
}

export interface LogPattern {
  template: string;
  severity: 'error' | 'warning' | 'info';
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  stillActive: boolean;
  sample: string;
  correlatedWith: string[];
}

export interface RequestSummary {
  total: number;
  byStatus: Record<string, number>;
  topErrors: Array<{ path: string; count: number; avgMs: number }>;
  slowRequests: Array<{ path: string; count: number; avgMs: number }>;
}

export interface ToolCallResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}
