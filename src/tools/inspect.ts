import * as api from '../render-api.js';
import type { TopologySnapshot, ToolCallResult } from '../types.js';
import { getResourceType, getResourceName, ID_PREFIX } from '../types.js';

interface ServiceDetails {
  plan?: string;
  region?: string;
  url?: string;
}

interface DeployCommit {
  id?: string;
  message?: string;
}

interface DeployWithCommit {
  id: string;
  status?: string;
  createdAt?: string;
  finishedAt?: string;
  commit?: DeployCommit;
}

export async function handleInspect(
  args: { resourceId: string },
  snapshot: TopologySnapshot
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

  const name = getResourceName(snapshot, args.resourceId) ?? args.resourceId;

  if (type === 'service') {
    const service = await api.retrieveService(args.resourceId);
    const deploys = await api.fetchDeploys(args.resourceId, 1);
    const lastDeploy = deploys[0] as DeployWithCommit | undefined;

    const details = service.serviceDetails as ServiceDetails | undefined;
    const lines: string[] = [
      `## ${service.name} (${service.id})`,
      `Type: ${service.type}`,
      `Plan: ${details?.plan ?? 'unknown'}`,
      `Region: ${details?.region ?? 'unknown'}`,
      `Branch: ${service.branch ?? 'n/a'}`,
      `Created: ${service.createdAt?.slice(0, 10) ?? 'unknown'}`,
      `Suspended: ${service.suspended}`,
    ];

    if (lastDeploy) {
      lines.push('');
      lines.push('### Last Deploy');
      lines.push(`ID: ${lastDeploy.id}`);
      lines.push(`Status: ${lastDeploy.status ?? 'unknown'}`);
      if (lastDeploy.commit) {
        lines.push(`Commit: ${lastDeploy.commit.id?.slice(0, 7) ?? '?'} — ${lastDeploy.commit.message ?? ''}`);
      }
      lines.push(`Created: ${lastDeploy.createdAt ?? 'unknown'}`);
      if (lastDeploy.finishedAt) lines.push(`Finished: ${lastDeploy.finishedAt}`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  if (type === 'postgres') {
    const db = await api.retrievePostgres(args.resourceId);
    const lines: string[] = [
      `## ${db.name} (${db.id})`,
      `Type: postgres`,
      `Version: ${db.version}`,
      `Plan: ${db.plan}`,
      `Region: ${db.region}`,
      `Status: ${db.status}`,
      `Database: ${db.databaseName}`,
      `User: ${db.databaseUser}`,
      `HA Enabled: ${db.highAvailabilityEnabled}`,
      `Created: ${db.createdAt?.slice(0, 10) ?? 'unknown'}`,
    ];

    const dbAny = db as Record<string, unknown>;
    if (dbAny.internalConnectionString || dbAny.primaryConnectionString) {
      lines.push('');
      lines.push('### Connection');
      if (dbAny.internalConnectionString) lines.push(`Internal: ${dbAny.internalConnectionString}`);
      if (dbAny.externalConnectionString) lines.push(`External: ${dbAny.externalConnectionString}`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  if (type === 'keyvalue') {
    const kv = await api.retrieveKeyValue(args.resourceId);
    let connInfo: Record<string, unknown> | null = null;
    try {
      connInfo = await api.getKeyValueConnectionInfo(args.resourceId) as Record<string, unknown>;
    } catch { /* connection info may not be available */ }

    const lines: string[] = [
      `## ${kv.name} (${kv.id})`,
      `Type: redis (Key Value)`,
      `Plan: ${kv.plan}`,
      `Region: ${kv.region}`,
      `Status: ${kv.status}`,
      `Max Memory Policy: ${kv.maxmemoryPolicy}`,
      `Created: ${kv.createdAt?.slice(0, 10) ?? 'unknown'}`,
    ];

    if (connInfo) {
      lines.push('');
      lines.push('### Connection');
      if (connInfo.internalConnectionString) lines.push(`Internal: ${connInfo.internalConnectionString}`);
      if (connInfo.externalConnectionString) lines.push(`External: ${connInfo.externalConnectionString}`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  return {
    content: [{ type: 'text', text: `Unknown resource type for ID: ${args.resourceId}` }],
    isError: true,
  };
}
