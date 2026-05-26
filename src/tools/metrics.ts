import * as api from '../render-api.js';
import { MetricsProcessor } from '../metrics-processor.js';
import type { TopologySnapshot, ToolCallResult } from '../types.js';
import { getResourceName } from '../types.js';

const processor = new MetricsProcessor();

export async function handleMetrics(
  args: {
    resourceId: string;
    startTime?: string;
    endTime?: string;
    raw?: boolean;
  },
  snapshot: TopologySnapshot
): Promise<ToolCallResult> {
  const name = getResourceName(snapshot, args.resourceId) ?? args.resourceId;
  const end = args.endTime ? new Date(args.endTime) : new Date();
  const start = args.startTime
    ? new Date(args.startTime)
    : new Date(end.getTime() - 60 * 60 * 1000);

  const bundle = await api.fetchMetricsBundle(args.resourceId, { start, end });

  if (args.raw) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(bundle, null, 2),
      }],
    };
  }

  const summary = processor.summarize(args.resourceId, name, { start, end }, bundle);
  return {
    content: [{ type: 'text', text: processor.formatSummary(summary) }],
  };
}
