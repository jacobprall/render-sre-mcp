import * as api from '../render-api.js';
import {
  formatKeyValueInspect,
  formatPostgresInspect,
  formatServiceInspect,
  type DeployWithCommit,
} from '../formatters/inspect.js';
import type { TopologySnapshot, ToolCallResult } from '../types.js';
import { getResourceType, ID_PREFIX } from '../types.js';

export async function handleInspect(
  args: { resourceId: string },
  _snapshot: TopologySnapshot
): Promise<ToolCallResult> {
  const type = getResourceType(args.resourceId);
  if (!type) {
    return {
      content: [{
        type: 'text',
        text: `Unknown resource ID: "${args.resourceId}". Expected prefix: ${ID_PREFIX.service}, ${ID_PREFIX.postgres}, or ${ID_PREFIX.keyvalue}`,
      }],
      isError: true,
    };
  }

  if (type === 'service') {
    const service = await api.retrieveService(args.resourceId);
    const deploys = await api.fetchDeploys(args.resourceId, 1);
    const lastDeploy = deploys[0] as DeployWithCommit | undefined;
    return {
      content: [{ type: 'text', text: formatServiceInspect(service, lastDeploy) }],
    };
  }

  if (type === 'postgres') {
    const db = await api.retrievePostgres(args.resourceId);
    return {
      content: [{ type: 'text', text: formatPostgresInspect(db) }],
    };
  }

  if (type === 'keyvalue') {
    const kv = await api.retrieveKeyValue(args.resourceId);
    let connInfo: Record<string, unknown> | null = null;
    try {
      connInfo = await api.getKeyValueConnectionInfo(args.resourceId) as Record<string, unknown>;
    } catch { /* connection info may not be available */ }
    return {
      content: [{ type: 'text', text: formatKeyValueInspect(kv, connInfo) }],
    };
  }

  return {
    content: [{ type: 'text', text: `Unknown resource type for ID: ${args.resourceId}` }],
    isError: true,
  };
}
