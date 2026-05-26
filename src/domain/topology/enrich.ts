import type { Service } from 'render-api';
import { loadConfig } from '../../config.js';
import { runWithConcurrency } from '../../lib/concurrency.js';
import { formatAge } from '../../lib/time.js';
import * as api from '../../render-api.js';
import type { HotResourceTracker } from '../../hot-resources.js';
import { computeHotResourceIds, computeHotServiceIds } from '../../hot-resources.js';
import type {
  DeployHint,
  ErrorIndicator,
  PressureHint,
  TopologySnapshot,
} from '../../types/topology.js';

const MAX_CONCURRENCY = 8;

export async function enrichErrorIndicatorsAndEnvCounts(
  services: Service[],
  windowMinutes: number
): Promise<{
  envVarCounts: Map<string, number>;
  errorIndicators: Map<string, ErrorIndicator>;
}> {
  const envVarCounts = new Map<string, number>();
  const errorIndicators = new Map<string, ErrorIndicator>();
  const startTime = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const indicatorTasks = services.map(svc => async () => {
    try {
      const logs = await api.fetchServiceLogs(svc.id, {
        startTime,
        severity: 'error',
        limit: 100,
      });
      const count = logs.length;
      errorIndicators.set(svc.id, {
        count,
        label: count > 0 ? `${count} errors in last ${windowMinutes}m` : 'clean',
      });
    } catch {
      errorIndicators.set(svc.id, { count: 0, label: 'unknown' });
    }
  });

  const envVarTasks = services.map(svc => async () => {
    try {
      const vars = await api.fetchEnvVars(svc.id);
      envVarCounts.set(svc.id, vars.length);
    } catch {
      envVarCounts.set(svc.id, 0);
    }
  });

  await runWithConcurrency([...indicatorTasks, ...envVarTasks], MAX_CONCURRENCY);
  return { envVarCounts, errorIndicators };
}

export async function enrichHotHints(
  partialSnapshot: TopologySnapshot,
  hotTracker: HotResourceTracker
): Promise<{
  deployHints: Map<string, DeployHint>;
  pressureHints: Map<string, PressureHint>;
}> {
  const hotServices = computeHotServiceIds(partialSnapshot, hotTracker);
  const hotResources = computeHotResourceIds(partialSnapshot, hotTracker);
  const deployHints = new Map<string, DeployHint>();
  const pressureHints = new Map<string, PressureHint>();

  const deployTasks = [...hotServices].map(serviceId => async () => {
    try {
      const deploys = await api.fetchDeploys(serviceId, 1);
      const d = deploys[0];
      if (!d) return;
      const liveAt = d.finishedAt ?? d.updatedAt ?? d.createdAt ?? '';
      deployHints.set(serviceId, {
        ageLabel: liveAt ? formatAge(liveAt) : '?',
        status: d.status ?? 'unknown',
        deployId: d.id,
      });
    } catch { /* omit hint */ }
  });

  const pressureTasks = [...hotResources].map(resourceId => async () => {
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 15 * 60 * 1000);
      const bundle = await api.fetchMetricsBundle(resourceId, { start, end });
      const hint: PressureHint = {};

      const memPeak = bundle.memory?.length
        ? Math.max(...bundle.memory.map(p => p.value))
        : undefined;
      const memLimit = bundle.memoryLimit?.length
        ? Math.max(...bundle.memoryLimit.map(p => p.value))
        : undefined;
      if (memPeak != null && memLimit != null && memLimit > 0) {
        const pct = Math.round((memPeak / memLimit) * 100);
        if (pct >= 75) hint.memoryPct = pct;
      }
      if (bundle.httpLatencyP95Peak != null && bundle.httpLatencyP95Peak > 1500) {
        hint.p95LatencyMs = Math.round(bundle.httpLatencyP95Peak);
      }

      if (hint.memoryPct != null || hint.p95LatencyMs != null) {
        pressureHints.set(resourceId, hint);
      }
    } catch { /* omit */ }
  });

  await runWithConcurrency([...deployTasks, ...pressureTasks], MAX_CONCURRENCY);
  return { deployHints, pressureHints };
}

export function getLogWindowMinutes(): number {
  return loadConfig().logDefaultWindowMin;
}
