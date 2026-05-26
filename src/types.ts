import type { Service, Postgres, KeyValue, Deploy, Job, EnvVar } from 'render-api';
import type { LogEntry } from './render-api.js';

export type { Service, Postgres, KeyValue, Deploy, Job, EnvVar, LogEntry };

export const ID_PREFIX = {
  service: 'srv-',
  postgres: 'dpg-',
  keyvalue: 'red-',
} as const;

export interface DeployHint {
  ageLabel: string;
  status: string;
  deployId?: string;
}

export interface PressureHint {
  memoryPct?: number;
  p95LatencyMs?: number;
}

export interface TopologySnapshot {
  services: Service[];
  databases: Postgres[];
  keyValueStores: KeyValue[];
  fetchedAt: number;
  envVarCounts: Map<string, number>;
  errorIndicators: Map<string, ErrorIndicator>;
  deployHints: Map<string, DeployHint>;
  pressureHints: Map<string, PressureHint>;
}

export interface DeployTimelineEntry {
  id: string;
  status: string;
  createdAt: string;
  finishedAt?: string;
  durationMs?: number;
  commitId?: string;
  commitMessage?: string;
  regressionCandidate: boolean;
}

export interface DeployTimeline {
  serviceId: string;
  serviceName: string;
  entries: DeployTimelineEntry[];
  summary: string;
}

export interface MetricSignal {
  severity: 'warning' | 'critical' | 'info';
  message: string;
}

export interface UtilizationLine {
  metric: string;
  peak: string;
  limit?: string;
  pct?: number;
}

export interface HttpSummary {
  p95Ms?: number;
  requestNote?: string;
}

export interface MetricsSummary {
  resourceId: string;
  resourceName: string;
  window: { start: string; end: string };
  signals: MetricSignal[];
  utilization: UtilizationLine[];
  http?: HttpSummary;
  connections?: string;
}

export interface SuggestedAction {
  tool: string;
  description: string;
  args?: Record<string, unknown>;
  requiresConfirmation?: boolean;
}

export interface EvidenceBlock {
  title: string;
  body: string;
}

export interface IncidentBrief {
  resourceId: string;
  resourceName: string;
  window: { start: Date; end: Date };
  hypothesis: string;
  confidence: 'low' | 'medium' | 'high';
  evidence: EvidenceBlock[];
  suggestedActions: SuggestedAction[];
  risks: string[];
}

export interface ErrorIndicator {
  count: number;
  label: string;
}

export type ResourceType = 'service' | 'postgres' | 'keyvalue';

export function getResourceType(id: string): ResourceType | null {
  if (id.startsWith(ID_PREFIX.service)) return 'service';
  if (id.startsWith(ID_PREFIX.postgres)) return 'postgres';
  if (id.startsWith(ID_PREFIX.keyvalue)) return 'keyvalue';
  return null;
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
