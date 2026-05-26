import type { TopologySnapshot } from '../../types/topology.js';
import { formatAllResourcesTable } from './formatTables.js';

export const WORKSPACE_RESOURCE_URI = 'render://workspace';

export function formatWorkspaceInventory(snapshot: TopologySnapshot): string {
  const iso = new Date(snapshot.fetchedAt).toISOString();
  const time = iso.slice(11, 19);
  return [
    'Render workspace inventory (read-only). Use resourceId values with render_workspace, render_observe, and other tools.',
    '',
    formatAllResourcesTable(snapshot),
    '',
    `(Infrastructure state as of ${time} UTC)`,
  ].join('\n');
}
