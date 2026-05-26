import * as api from '../render-api.js';
import type { TopologySnapshot, ToolCallResult } from '../types.js';
import { getResourceName } from '../types.js';

interface DeployWithCommit {
  id: string;
  status?: string;
  commit?: { id?: string; message?: string };
}

export async function handleDeploy(
  args: { serviceId: string; clearCache?: boolean },
  snapshot: TopologySnapshot
): Promise<ToolCallResult> {
  const name = getResourceName(snapshot, args.serviceId) ?? args.serviceId;
  const deploy = await api.triggerDeploy(args.serviceId, { clearCache: args.clearCache });
  const d = deploy as unknown as DeployWithCommit;
  const commit = d.commit
    ? `\nCommit: ${d.commit.id?.slice(0, 7) ?? 'unknown'} — ${d.commit.message ?? ''}`
    : '';
  return {
    content: [{
      type: 'text',
      text: `Deploy triggered on ${name} (${args.serviceId})\nDeploy ID: ${deploy.id}\nStatus: ${deploy.status}${commit}`,
    }],
  };
}
