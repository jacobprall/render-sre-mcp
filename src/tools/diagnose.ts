import * as api from '../render-api.js';
import { DeployTimelineBuilder } from '../deploy-timeline.js';
import { IncidentBriefBuilder } from '../incident-brief.js';
import { LogProcessor } from '../log-processor.js';
import { MetricsProcessor } from '../metrics-processor.js';
import type { TopologySnapshot, ToolCallResult } from '../types.js';
import { getResourceName, getResourceType } from '../types.js';

const deployBuilder = new DeployTimelineBuilder();
const metricsProcessor = new MetricsProcessor();
const briefBuilder = new IncidentBriefBuilder();
const logProcessor = new LogProcessor();

export async function handleDiagnose(
  args: {
    resourceId: string;
    symptom?: string;
    windowMinutes?: number;
  },
  snapshot: TopologySnapshot
): Promise<ToolCallResult> {
  const name = getResourceName(snapshot, args.resourceId) ?? args.resourceId;
  const windowMinutes = args.windowMinutes ?? 60;
  const end = new Date();
  const start = new Date(end.getTime() - windowMinutes * 60 * 1000);

  const [logEntries, deployList, metricsBundle] = await Promise.all([
    api.fetchServiceLogs(args.resourceId, {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      limit: 500,
    }).catch(() => []),
    getResourceType(args.resourceId) === 'service'
      ? api.fetchDeploys(args.resourceId, 5).catch(() => [])
      : Promise.resolve([]),
    api.fetchMetricsBundle(args.resourceId, { start, end }).catch(() => null),
  ]);

  const logs = logEntries.length > 0
    ? logProcessor.process(logEntries, args.resourceId, name, { start, end })
    : null;

  const logsFormatted = logs
    ? logProcessor.formatSummary(logs).split('\n').slice(0, 12).join('\n')
    : undefined;

  const errorCount = snapshot.errorIndicators.get(args.resourceId)?.count ?? 0;
  const deploys = deployList.length > 0
    ? deployBuilder.build(args.resourceId, name, deployList, {
        errorCountInWindow: errorCount,
        windowStart: start,
      })
    : null;

  const metrics = metricsBundle
    ? metricsProcessor.summarize(args.resourceId, name, { start, end }, metricsBundle)
    : null;

  const brief = briefBuilder.build({
    resourceId: args.resourceId,
    resourceName: name,
    window: { start, end },
    symptom: args.symptom,
    logs,
    logsFormatted,
    deploys,
    metrics,
    snapshot,
  });

  return {
    content: [{ type: 'text', text: briefBuilder.format(brief) }],
  };
}
