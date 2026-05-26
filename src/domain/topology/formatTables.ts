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

function serviceLineExtras(snapshot: TopologySnapshot, serviceId: string): string {
  const deploy = snapshot.deployHints.get(serviceId);
  if (!deploy) return '';
  return ` │ deploy ${deploy.ageLabel} · ${deploy.status}`;
}

function formatDatastoreRows(snapshot: TopologySnapshot): string[] {
  const lines: string[] = [];
  for (const d of snapshot.databases) {
    lines.push(`${d.id} │ ${d.name} │ postgres │ ${d.status}`);
  }
  for (const k of snapshot.keyValueStores) {
    lines.push(`${k.id} │ ${k.name} │ redis │ ${k.status}`);
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
    const serviceUrl = s.serviceDetails?.url;
    const url = includeUrl && serviceUrl ? ` │ ${serviceUrl}` : '';
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
    const status = serviceStatusLabel(s);
    lines.push(`${s.id} │ ${s.name} │ ${type} │ ${status}${serviceLineExtras(snapshot, s.id)}`);
  }
  lines.push(...formatDatastoreRows(snapshot));
  return 'Resources:\n' + lines.join('\n');
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
