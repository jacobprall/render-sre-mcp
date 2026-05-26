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
