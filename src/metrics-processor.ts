import type { MetricsSummary, MetricSignal, UtilizationLine } from './types.js';

export interface MetricSeriesPoint {
  timestamp: string;
  value: number;
}

export interface RawMetricsBundle {
  memory?: MetricSeriesPoint[];
  memoryLimit?: MetricSeriesPoint[];
  cpu?: MetricSeriesPoint[];
  httpLatencyP95Peak?: number;
  activeConnections?: MetricSeriesPoint[];
}

export class MetricsProcessor {
  summarize(
    resourceId: string,
    resourceName: string,
    window: { start: Date; end: Date },
    raw: RawMetricsBundle
  ): MetricsSummary {
    const utilization: UtilizationLine[] = [];
    const signals: MetricSignal[] = [];

    const memPeak = peak(raw.memory);
    const memLimit = peak(raw.memoryLimit);
    if (memPeak != null) {
      const pct = memLimit && memLimit > 0 ? Math.round((memPeak / memLimit) * 100) : undefined;
      utilization.push({
        metric: 'memory',
        peak: formatBytes(memPeak),
        limit: memLimit != null ? formatBytes(memLimit) : undefined,
        pct,
      });
      if (pct != null && pct >= 90) {
        signals.push({ severity: 'critical', message: `Memory at ~${pct}% of limit` });
      } else if (pct != null && pct >= 75) {
        signals.push({ severity: 'warning', message: `Memory elevated (~${pct}% of limit)` });
      }
    }

    const cpuPeak = peak(raw.cpu);
    if (cpuPeak != null) {
      utilization.push({
        metric: 'cpu',
        peak: `${cpuPeak.toFixed(2)}`,
      });
    }

    const connPeak = peak(raw.activeConnections);
    if (connPeak != null) {
      utilization.push({ metric: 'active_connections', peak: String(Math.round(connPeak)) });
      if (connPeak > 90) {
        signals.push({ severity: 'warning', message: `High active connections (peak ${Math.round(connPeak)})` });
      }
    }

    let http: MetricsSummary['http'];
    if (raw.httpLatencyP95Peak != null) {
      http = { p95Ms: Math.round(raw.httpLatencyP95Peak) };
      if (raw.httpLatencyP95Peak > 2000) {
        signals.push({ severity: 'warning', message: `HTTP p95 peak latency ${Math.round(raw.httpLatencyP95Peak)}ms` });
      }
    }

    if (utilization.length === 0 && signals.length === 0) {
      signals.push({ severity: 'info', message: 'No metrics available for this resource in the time window.' });
    }

    return {
      resourceId,
      resourceName,
      window: { start: window.start.toISOString(), end: window.end.toISOString() },
      signals,
      utilization,
      http,
      connections: connPeak != null ? `peak ${Math.round(connPeak)}` : undefined,
    };
  }

  formatSummary(summary: MetricsSummary): string {
    const lines: string[] = [
      `## Metrics: ${summary.resourceName} (${summary.resourceId})`,
      `Window: ${summary.window.start.slice(11, 19)} – ${summary.window.end.slice(11, 19)}`,
      '',
    ];

    if (summary.utilization.length > 0) {
      lines.push('### Utilization');
      for (const u of summary.utilization) {
        const lim = u.limit ? ` / ${u.limit}` : '';
        const pct = u.pct != null ? ` (${u.pct}%)` : '';
        lines.push(`- ${u.metric}: peak ${u.peak}${lim}${pct}`);
      }
    }

    if (summary.http?.p95Ms != null) {
      lines.push('', '### HTTP', `- p95 peak latency: ${summary.http.p95Ms}ms`);
    }

    if (summary.connections) {
      lines.push('', '### Connections', `- ${summary.connections}`);
    }

    if (summary.signals.length > 0) {
      lines.push('', '### Signals');
      for (const s of summary.signals) {
        lines.push(`- [${s.severity}] ${s.message}`);
      }
    }

    return lines.join('\n');
  }
}

function peak(series?: MetricSeriesPoint[]): number | undefined {
  if (!series?.length) return undefined;
  return Math.max(...series.map(p => p.value));
}

const KiB = 1024;
const MiB = 1024 * 1024;
const GiB = 1024 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n >= GiB) return `${(n / GiB).toFixed(1)} GiB`;
  if (n >= MiB) return `${(n / MiB).toFixed(0)} MiB`;
  if (n >= KiB) return `${(n / KiB).toFixed(0)} KiB`;
  return `${Math.round(n)} B`;
}
