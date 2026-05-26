import * as api from '../render-api.js';
import { LogProcessor } from '../log-processor.js';
import type { TopologySnapshot, ToolCallResult } from '../types.js';
import { getResourceName } from '../types.js';

const processor = new LogProcessor();

export async function handleLogs(
  args: {
    resourceId: string;
    raw?: boolean;
    severity?: 'error' | 'warning' | 'info';
    startTime?: string;
    endTime?: string;
    search?: string;
    limit?: number;
  },
  snapshot: TopologySnapshot
): Promise<ToolCallResult> {
  const name = getResourceName(snapshot, args.resourceId) ?? args.resourceId;
  const windowMinutes = Number(process.env.RENDER_LOG_DEFAULT_WINDOW_MIN ?? 10);
  const endTime = args.endTime ?? new Date().toISOString();
  const startTime = args.startTime ?? new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const severityMap: Record<string, 'error' | 'warn' | 'info'> = {
    error: 'error',
    warning: 'warn',
    info: 'info',
  };

  if (args.raw) {
    const logs = await api.fetchServiceLogs(args.resourceId, {
      startTime,
      endTime,
      severity: args.severity ? severityMap[args.severity] : undefined,
      limit: args.limit ?? 100,
      direction: 'backward',
    });

    let filtered = logs;
    if (args.search) {
      const searchLower = args.search.toLowerCase();
      filtered = logs.filter(l => l.message.toLowerCase().includes(searchLower));
    }

    const lines = filtered.map(l => {
      const level = l.labels.find(lb => lb.name === 'level')?.value ?? 'info';
      return `${l.timestamp} [${level}] ${l.message}`;
    });
    return {
      content: [{
        type: 'text',
        text: lines.length > 0
          ? lines.join('\n')
          : `No logs found for ${name} (${args.resourceId}) in the specified time window.`,
      }],
    };
  }

  const logs = await api.fetchServiceLogs(args.resourceId, {
    startTime,
    endTime,
    limit: 500,
    direction: 'backward',
  });

  const summary = processor.process(
    logs,
    args.resourceId,
    name,
    { start: new Date(startTime), end: new Date(endTime) }
  );

  return {
    content: [{
      type: 'text',
      text: processor.formatSummary(summary),
    }],
  };
}
