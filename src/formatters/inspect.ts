import type { KeyValue, Postgres, Service } from '../types/render-api.js';

interface ServiceDetails {
  plan?: string;
  region?: string;
  url?: string;
}

interface DeployCommit {
  id?: string;
  message?: string;
}

export interface DeployWithCommit {
  id: string;
  status?: string;
  createdAt?: string;
  finishedAt?: string;
  commit?: DeployCommit;
}

function appendConnectionSection(
  lines: string[],
  conn: Record<string, unknown>
): void {
  lines.push('');
  lines.push('### Connection');
  if (conn.internalConnectionString) {
    lines.push(`Internal: ${conn.internalConnectionString}`);
  }
  if (conn.externalConnectionString) {
    lines.push(`External: ${conn.externalConnectionString}`);
  }
  if (conn.primaryConnectionString) {
    lines.push(`Primary: ${conn.primaryConnectionString}`);
  }
}

export function formatServiceInspect(
  service: Service,
  lastDeploy?: DeployWithCommit
): string {
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
      lines.push(
        `Commit: ${lastDeploy.commit.id?.slice(0, 7) ?? '?'} — ${lastDeploy.commit.message ?? ''}`
      );
    }
    lines.push(`Created: ${lastDeploy.createdAt ?? 'unknown'}`);
    if (lastDeploy.finishedAt) lines.push(`Finished: ${lastDeploy.finishedAt}`);
  }

  return lines.join('\n');
}

export function formatPostgresInspect(db: Postgres): string {
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
    appendConnectionSection(lines, dbAny);
  }

  return lines.join('\n');
}

export function formatKeyValueInspect(
  kv: KeyValue,
  connInfo: Record<string, unknown> | null
): string {
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
    appendConnectionSection(lines, connInfo);
  }

  return lines.join('\n');
}
