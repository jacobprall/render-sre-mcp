import * as api from '../render-api.js';
import type { TopologySnapshot, ToolCallResult } from '../types.js';
import { getResourceName } from '../types.js';

export async function handleRestart(
  args: { serviceId: string },
  snapshot: TopologySnapshot
): Promise<ToolCallResult> {
  const name = getResourceName(snapshot, args.serviceId) ?? args.serviceId;
  await api.restartService(args.serviceId);
  return {
    content: [{
      type: 'text',
      text: `Restarted ${name} (${args.serviceId})\nNew instance started at ${new Date().toISOString()}`,
    }],
  };
}
