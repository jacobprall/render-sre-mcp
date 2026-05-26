import type { Service, Postgres, KeyValue } from 'render-api';

export interface DeployHint {
  ageLabel: string;
  status: string;
  deployId?: string;
}

export interface PressureHint {
  memoryPct?: number;
  p95LatencyMs?: number;
}

export interface ErrorIndicator {
  count: number;
  label: string;
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
