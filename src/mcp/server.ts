import { McpServer } from '@modelcontextprotocol/server';
import { getHotResourceTracker } from '../hot-resources.js';
import { TopologyCache } from '../domain/topology/cache.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { registerWorkspaceResource } from './resources.js';
import { registerTools } from './tool-registry.js';

const RESOURCE_REFRESH_DEBOUNCE_MS = 5_000;

export interface CreateServerResult {
  mcpServer: McpServer;
  topology: TopologyCache;
  /** @deprecated Tool descriptions are static; refreshes workspace resource only. */
  updateAllDescriptions: () => void;
  notifyWorkspaceChanged: () => Promise<void>;
}

export async function createServer(topology?: TopologyCache): Promise<CreateServerResult> {
  const hotTracker = getHotResourceTracker();
  const topo = topology ?? new TopologyCache(hotTracker);
  await topo.ensureFresh();

  const mcpServer = new McpServer(
    { name: 'render-mcp-server', version: '0.3.0' },
    {
      instructions: SERVER_INSTRUCTIONS,
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
      },
    }
  );

  registerWorkspaceResource(mcpServer, topo);

  let lastResourceNotification = 0;

  registerTools(mcpServer, topo, hotTracker, () => {
    void refreshWorkspace();
  });

  async function refreshWorkspace() {
    try {
      const changed = await topo.refresh();
      if (changed && Date.now() - lastResourceNotification > RESOURCE_REFRESH_DEBOUNCE_MS) {
        lastResourceNotification = Date.now();
        mcpServer.sendResourceListChanged();
      }
    } catch { /* best effort */ }
  }

  async function notifyWorkspaceChanged() {
    mcpServer.sendResourceListChanged();
  }

  return {
    mcpServer,
    topology: topo,
    updateAllDescriptions: () => {},
    notifyWorkspaceChanged,
  };
}
