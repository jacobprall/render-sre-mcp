import type { TopologySnapshot } from '../../types/topology.js';

const TYPE_LABELS: Record<string, string> = {
  static_site: 'static',
  web_service: 'web',
  private_service: 'private',
  background_worker: 'worker',
  cron_job: 'cron',
};

function serviceStatusLabel(s: { suspended: string }): string {
  if (s.suspended === 'suspended') return 'suspended';
  return 'deployed';
}

function pressureLabel(snapshot: TopologySnapshot, resourceId: string): string {
  const hint = snapshot.pressureHints.get(resourceId);
  if (!hint) return '';
  const parts: string[] = [];
  if (hint.memoryPct != null) parts.push(`mem ~${hint.memoryPct}%`);
  if (hint.p95LatencyMs != null) parts.push(`p95 ${hint.p95LatencyMs}ms`);
  return parts.join(', ');
}

function serviceLineExtras(snapshot: TopologySnapshot, serviceId: string): string {
  const parts: string[] = [];
  const deploy = snapshot.deployHints.get(serviceId);
  if (deploy) parts.push(`deploy ${deploy.ageLabel} · ${deploy.status}`);
  const pressure = pressureLabel(snapshot, serviceId);
  if (pressure) parts.push(pressure);
  return parts.length ? ' │ ' + parts.join(' │ ') : '';
}

function formatDatastoreRows(snapshot: TopologySnapshot): string[] {
  const lines: string[] = [];
  for (const d of snapshot.databases) {
    const pressure = pressureLabel(snapshot, d.id);
    lines.push(`${d.id} │ ${d.name} │ postgres │ ${d.status}${pressure ? ` │ ${pressure}` : ''}`);
  }
  for (const k of snapshot.keyValueStores) {
    const pressure = pressureLabel(snapshot, k.id);
    lines.push(`${k.id} │ ${k.name} │ redis │ ${k.status}${pressure ? ` │ ${pressure}` : ''}`);
  }
  return lines;
}

export function formatServicesTable(snapshot: TopologySnapshot, includeUrl = true): string {
  if (snapshot.services.length === 0) {
    return 'No services found. Deploy via render.yaml or the Render Dashboard to get started.';
  }
  const lines = snapshot.services.map(s => {
    const type = TYPE_LABELS[s.type] ?? s.type;
    const status = serviceStatusLabel(s);
    const url =
      includeUrl && 'url' in s.serviceDetails && (s.serviceDetails as { url?: string }).url
        ? ` │ ${(s.serviceDetails as { url?: string }).url}`
        : '';
    return `${s.id} │ ${s.name} │ ${type} │ ${status}${url}${serviceLineExtras(snapshot, s.id)}`;
  });
  return 'Services:\n' + lines.join('\n');
}

export function formatLogsTable(snapshot: TopologySnapshot): string {
  const allEmpty =
    snapshot.services.length === 0 &&
    snapshot.databases.length === 0 &&
    snapshot.keyValueStores.length === 0;
  if (allEmpty) {
    return 'No resources found. Deploy via render.yaml or the Render Dashboard to get started.';
  }
  const lines: string[] = [];
  for (const s of snapshot.services) {
    const type = TYPE_LABELS[s.type] ?? s.type;
    const indicator = snapshot.errorIndicators.get(s.id)?.label ?? 'unknown';
    lines.push(`${s.id} │ ${s.name} │ ${type} │ ${indicator}${serviceLineExtras(snapshot, s.id)}`);
  }
  lines.push(...formatDatastoreRows(snapshot));
  return 'Resources:\n' + lines.join('\n');
}

export function formatEnvVarsTable(snapshot: TopologySnapshot): string {
  if (snapshot.services.length === 0) {
    return 'No services found. Deploy via render.yaml or the Render Dashboard to get started.';
  }
  const lines = snapshot.services.map(s => {
    const count = snapshot.envVarCounts.get(s.id) ?? 0;
    return `${s.id} │ ${s.name} │ ${count} env vars`;
  });
  return 'Services:\n' + lines.join('\n');
}

export function formatAllResourcesTable(snapshot: TopologySnapshot): string {
  const lines: string[] = [];
  for (const s of snapshot.services) {
    const type = TYPE_LABELS[s.type] ?? s.type;
    const status = serviceStatusLabel(s);
    lines.push(`${s.id} │ ${s.name} │ ${type} │ ${status}${serviceLineExtras(snapshot, s.id)}`);
  }
  lines.push(...formatDatastoreRows(snapshot));
  if (lines.length === 0) {
    return 'No resources found. Deploy via render.yaml or the Render Dashboard to get started.';
  }
  return 'Resources:\n' + lines.join('\n');
}
