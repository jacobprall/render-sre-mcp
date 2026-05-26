import type { MetricPoint, MetricResponse } from '../types/render-api.js';
import { renderGet } from './http.js';

export type { MetricPoint };

interface MetricsQuery {
  resourceIds: string[];
  startTime?: string;
  endTime?: string;
}

function metricsQuery(params: MetricsQuery): Record<string, string> {
  const query: Record<string, string> = {
    resourceIds: params.resourceIds.join(','),
  };
  if (params.startTime) query.startTime = params.startTime;
  if (params.endTime) query.endTime = params.endTime;
  return query;
}

async function fetchMetricSeries(
  path: string,
  resourceId: string,
  window: { startTime: string; endTime: string }
): Promise<MetricPoint[]> {
  try {
    const resp = await renderGet<MetricResponse>(path, metricsQuery({
      resourceIds: [resourceId],
      startTime: window.startTime,
      endTime: window.endTime,
    }));
    const points: MetricPoint[] = [];
    for (const s of resp.series ?? []) {
      for (const v of s.values ?? []) points.push(v);
    }
    return points;
  } catch {
    return [];
  }
}

export async function fetchMetricsBundle(
  resourceId: string,
  window: { start: Date; end: Date }
) {
  const range = {
    startTime: window.start.toISOString(),
    endTime: window.end.toISOString(),
  };
  const isPostgres = resourceId.startsWith('dpg-');
  const isKv = resourceId.startsWith('red-');

  const [memory, memoryLimit, cpu, activeConnections] = await Promise.all([
    fetchMetricSeries('/metrics/memory', resourceId, range),
    fetchMetricSeries('/metrics/memory-limit', resourceId, range),
    isPostgres || isKv
      ? Promise.resolve([])
      : fetchMetricSeries('/metrics/cpu', resourceId, range),
    isPostgres || isKv
      ? fetchMetricSeries('/metrics/active-connections', resourceId, range)
      : Promise.resolve([]),
  ]);

  let httpLatencyP95Peak: number | undefined;
  if (!isPostgres && !isKv) {
    try {
      const latency = await renderGet<MetricResponse>('/metrics/http-latency', metricsQuery({
        resourceIds: [resourceId],
        ...range,
      }));
      const vals = latency.series?.flatMap(s => s.values.map(v => v.value)) ?? [];
      if (vals.length) httpLatencyP95Peak = Math.max(...vals);
    } catch { /* optional */ }
  }

  return { memory, memoryLimit, cpu, activeConnections, httpLatencyP95Peak };
}
