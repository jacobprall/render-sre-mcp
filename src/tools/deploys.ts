import * as api from '../render-api.js';
import { DeployTimelineBuilder } from '../deploy-timeline.js';
import { loadConfig } from '../config.js';
import type { TopologySnapshot, ToolCallResult } from '../types.js';
import { getResourceName } from '../types.js';

const builder = new DeployTimelineBuilder();

export async function handleDeploys(
  args: { serviceId: string; limit?: number },
  snapshot: TopologySnapshot
): Promise<ToolCallResult> {
  const name = getResourceName(snapshot, args.serviceId) ?? args.serviceId;
  const limit = Math.min(args.limit ?? 10, 20);
  const config = loadConfig();
  const windowStart = new Date(Date.now() - config.logDefaultWindowMin * 60 * 1000);
  const errorCount = snapshot.errorIndicators.get(args.serviceId)?.count ?? 0;

  const deploys = await api.fetchDeploys(args.serviceId, limit);
  const timeline = builder.build(args.serviceId, name, deploys, {
    errorCountInWindow: errorCount,
    windowStart,
  });

  return {
    content: [{ type: 'text', text: builder.format(timeline) }],
  };
}
