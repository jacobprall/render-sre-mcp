import * as api from '../render-api.js';
import type { TopologySnapshot, ToolCallResult } from '../types.js';
import { getResourceName } from '../types.js';

export async function handleDeploy(
  args: { serviceId: string; clearCache?: boolean },
  snapshot: TopologySnapshot
): Promise<ToolCallResult> {
  const name = getResourceName(snapshot, args.serviceId) ?? args.serviceId;
  const deploy = await api.triggerDeploy(args.serviceId, { clearCache: args.clearCache });
  const commit = (deploy as any).commit
    ? `\nCommit: ${(deploy as any).commit.id?.slice(0, 7) ?? 'unknown'} — ${(deploy as any).commit.message ?? ''}`
    : '';
  return {
    content: [{
      type: 'text',
      text: `Deploy triggered on ${name} (${args.serviceId})\nDeploy ID: ${deploy.id}\nStatus: ${deploy.status}${commit}`,
    }],
  };
}
