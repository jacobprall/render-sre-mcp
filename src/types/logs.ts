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
