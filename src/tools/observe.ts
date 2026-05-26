import * as api from '../render-api.js';
import { DeployTimelineBuilder } from '../deploy-timeline.js';
import { loadConfig } from '../config.js';
import { LogProcessor } from '../log-processor.js';
import { MetricsProcessor } from '../metrics-processor.js';
import type { TopologySnapshot, ToolCallResult } from '../types.js';
import { getResourceName, getResourceType } from '../types.js';
import { handleDeploys } from './deploys.js';
import { handleLogs } from './logs.js';
import { handleMetrics } from './metrics.js';

const deployBuilder = new DeployTimelineBuilder();
const logProcessor = new LogProcessor();
const metricsProcessor = new MetricsProcessor();

export type ObserveMode = 'bundle' | 'logs' | 'metrics' | 'deploys';

export async function handleObserve(
  args: {
    resourceId: string;
    mode?: ObserveMode;
    raw?: boolean;
    severity?: 'error' | 'warning' | 'info';
    startTime?: string;
    endTime?: string;
    search?: string;
    limit?: number;
    windowMinutes?: number;
  },
  snapshot: TopologySnapshot
): Promise<ToolCallResult> {
  const mode = args.mode ?? 'bundle';

  if (mode === 'logs') {
    return handleLogs(
      {
        resourceId: args.resourceId,
        raw: args.raw,
        severity: args.severity,
        startTime: args.startTime,
        endTime: args.endTime,
        search: args.search,
        limit: args.limit,
      },
      snapshot
    );
  }

  if (mode === 'metrics') {
    return handleMetrics(
      {
        resourceId: args.resourceId,
        startTime: args.startTime,
        endTime: args.endTime,
        raw: args.raw,
      },
      snapshot
    );
  }

  if (mode === 'deploys') {
    if (getResourceType(args.resourceId) !== 'service') {
      return {
        content: [{
          type: 'text',
          text: `Deploy history applies to services only. Got: ${args.resourceId}`,
        }],
        isError: true,
      };
    }
    return handleDeploys({ serviceId: args.resourceId, limit: args.limit }, snapshot);
  }

  return handleObserveBundle(args, snapshot);
}

async function handleObserveBundle(
  args: {
    resourceId: string;
    raw?: boolean;
    windowMinutes?: number;
    startTime?: string;
    endTime?: string;
  },
  snapshot: TopologySnapshot
): Promise<ToolCallResult> {
  const name = getResourceName(snapshot, args.resourceId) ?? args.resourceId;
  const windowMinutes = args.windowMinutes ?? 60;
  const end = args.endTime ? new Date(args.endTime) : new Date();
  const start = args.startTime
    ? new Date(args.startTime)
    : new Date(end.getTime() - windowMinutes * 60 * 1000);

  const config = loadConfig();
  const logEnd = args.endTime ?? end.toISOString();
  const logStart =
    args.startTime ??
    new Date(end.getTime() - config.logDefaultWindowMin * 60 * 1000).toISOString();

  const isService = getResourceType(args.resourceId) === 'service';

  const [logEntries, deployList, metricsBundle] = await Promise.all([
    api.fetchServiceLogs(args.resourceId, {
      startTime: logStart,
      endTime: logEnd,
      limit: 500,
      direction: 'backward',
    }).catch(() => []),
    isService
      ? api.fetchDeploys(args.resourceId, 5).catch(() => [])
      : Promise.resolve([]),
    api.fetchMetricsBundle(args.resourceId, { start, end }).catch(() => null),
  ]);

  const sections: string[] = [`## Observe: ${name} (${args.resourceId})`, ''];

  if (logEntries.length > 0) {
    const logs = logProcessor.process(logEntries, args.resourceId, name, { start, end });
    const body = logProcessor.formatSummary(logs).split('\n').slice(0, 20).join('\n');
    sections.push('### Logs', body, '');
  } else {
    sections.push('### Logs', 'No logs in window.', '');
  }

  if (isService && deployList.length > 0) {
    const timeline = deployBuilder.build(args.resourceId, name, deployList, {
      errorCountInWindow: 0,
      windowStart: start,
    });
    sections.push('### Deploys', deployBuilder.format(timeline).split('\n').slice(0, 15).join('\n'), '');
  } else if (isService) {
    sections.push('### Deploys', 'No deploy history.', '');
  }

  if (metricsBundle) {
    const summary = metricsProcessor.summarize(args.resourceId, name, { start, end }, metricsBundle);
    sections.push('### Metrics', metricsProcessor.formatSummary(summary), '');
  } else {
    sections.push('### Metrics', 'Metrics unavailable.', '');
  }

  if (args.raw) {
    sections.push('(Pass mode logs|metrics|deploys with raw:true for full drill-down.)');
  }

  return {
    content: [{ type: 'text', text: sections.join('\n') }],
  };
}
