import type { McpServer } from '@modelcontextprotocol/server';
import type { TopologyCache } from '../domain/topology/cache.js';
import {
  formatWorkspaceInventory,
  WORKSPACE_RESOURCE_URI,
} from '../domain/topology/workspace-document.js';

export function registerWorkspaceResource(
  mcpServer: McpServer,
  topology: TopologyCache
): void {
  mcpServer.registerResource(
    'workspace',
    WORKSPACE_RESOURCE_URI,
    {
      title: 'Render workspace inventory',
      description: 'Cached list of services, Postgres, and Redis with IDs and deploy hints.',
      mimeType: 'text/plain',
    },
    async () => {
      await topology.ensureFresh();
      const snapshot = topology.snapshot;
      const text = snapshot
        ? formatWorkspaceInventory(snapshot)
        : 'Workspace inventory unavailable (Render API unreachable). Retry shortly.';
      return {
        contents: [{ uri: WORKSPACE_RESOURCE_URI, mimeType: 'text/plain', text }],
      };
    }
  );
}
