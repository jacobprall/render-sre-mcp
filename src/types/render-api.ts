/** Types for Render REST API resources used by this MCP server. */

export interface ServiceDetails {
  plan?: string;
  region?: string;
  url?: string;
  [key: string]: unknown;
}

export interface Service {
  id: string;
  name: string;
  type: string;
  suspended: string;
  branch?: string;
  createdAt?: string;
  updatedAt?: string;
  serviceDetails?: ServiceDetails;
  [key: string]: unknown;
}

export interface Postgres {
  id: string;
  name: string;
  status: string;
  version?: string;
  plan?: string;
  region?: string;
  databaseName?: string;
  databaseUser?: string;
  highAvailabilityEnabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export type MaxmemoryPolicy =
  | 'noeviction'
  | 'allkeys_lru'
  | 'allkeys_lfu'
  | 'volatile_lru'
  | 'volatile_lfu'
  | 'allkeys_random'
  | 'volatile_random'
  | 'volatile_ttl';

export interface KeyValue {
  id: string;
  name: string;
  status: string;
  plan?: string;
  region?: string;
  maxmemoryPolicy: MaxmemoryPolicy;
  suspended: 'suspended' | 'not_suspended';
  suspenders: string[];
  createdAt?: string;
  updatedAt?: string;
  dashboardUrl?: string;
  ipAllowList?: unknown[];
  owner?: { id: string; name: string; email?: string };
  [key: string]: unknown;
}

export interface DeployCommit {
  id?: string;
  message?: string;
}

export interface Deploy {
  id: string;
  status?: string;
  createdAt?: string;
  finishedAt?: string;
  updatedAt?: string;
  commit?: DeployCommit;
  [key: string]: unknown;
}

export interface EnvVar {
  key: string;
  value?: string;
  [key: string]: unknown;
}

export interface Job {
  id: string;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  id: string;
  message: string;
  timestamp: string;
  labels: Array<{ name: string; value: string }>;
}

export interface MetricPoint {
  timestamp: string;
  value: number;
}

export interface MetricSeries {
  labels?: Record<string, string>;
  values: MetricPoint[];
}

export interface MetricResponse {
  series?: MetricSeries[];
}
