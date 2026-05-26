import { getClient } from './client.js';

export interface MetricPoint {
  timestamp: string;
  value: number;
}

async function fetchMetricSeries(
  resourceId: string,
  fetcher: (params: {
    resourceIds: string[];
    startTime?: string;
    endTime?: string;
  }) => Promise<{ series: Array<{ values: MetricPoint[] }> }>,
  window: { startTime: string; endTime: string }
): Promise<MetricPoint[]> {
  try {
    const c = getClient();
    const resp = await fetcher.call(c.metrics, {
      resourceIds: [resourceId],
      startTime: window.startTime,
      endTime: window.endTime,
    });
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
  const c = getClient();
  const range = {
    startTime: window.start.toISOString(),
    endTime: window.end.toISOString(),
  };
  const isPostgres = resourceId.startsWith('dpg-');
  const isKv = resourceId.startsWith('red-');

  const [memory, memoryLimit, cpu, activeConnections] = await Promise.all([
    fetchMetricSeries(resourceId, c.metrics.memory.bind(c.metrics), range),
    fetchMetricSeries(resourceId, c.metrics.memoryLimit.bind(c.metrics), range),
    isPostgres || isKv
      ? Promise.resolve([])
      : fetchMetricSeries(resourceId, c.metrics.cpu.bind(c.metrics), range),
    isPostgres || isKv
      ? fetchMetricSeries(resourceId, c.metrics.activeConnections.bind(c.metrics), range)
      : Promise.resolve([]),
  ]);

  let httpLatencyP95Peak: number | undefined;
  if (!isPostgres && !isKv) {
    try {
      const latency = await c.metrics.httpLatency({
        resourceIds: [resourceId],
        ...range,
      });
      const vals = latency.series?.flatMap(s => s.values.map(v => v.value)) ?? [];
      if (vals.length) httpLatencyP95Peak = Math.max(...vals);
    } catch { /* optional */ }
  }

  return { memory, memoryLimit, cpu, activeConnections, httpLatencyP95Peak };
}
