import { McpServer } from '@modelcontextprotocol/server';
import { getHotResourceTracker } from '../hot-resources.js';
import { TopologyCache } from '../domain/topology/cache.js';
import { registerTools } from './tool-registry.js';

const TOOL_REFRESH_DEBOUNCE_MS = 5_000;

export interface CreateServerResult {
  mcpServer: McpServer;
  topology: TopologyCache;
  updateAllDescriptions: () => void;
  notifyDescriptionsChanged: () => Promise<void>;
}

export async function createServer(topology?: TopologyCache): Promise<CreateServerResult> {
  const hotTracker = getHotResourceTracker();
  const topo = topology ?? new TopologyCache(hotTracker);
  await topo.ensureFresh();

  const mcpServer = new McpServer(
    { name: 'render-mcp-server', version: '0.2.0' },
    { capabilities: { tools: { listChanged: true } } }
  );

  let lastToolRefreshNotification = 0;

  const registeredTools = registerTools(mcpServer, topo, hotTracker, () => {
    void refreshAndNotify();
  });

  function updateAllDescriptions() {
    for (const [name, reg] of registeredTools) {
      reg.update({ description: topo.describe(name) });
    }
  }

  async function refreshAndNotify() {
    try {
      const changed = await topo.refresh();
      if (changed && Date.now() - lastToolRefreshNotification > TOOL_REFRESH_DEBOUNCE_MS) {
        lastToolRefreshNotification = Date.now();
        updateAllDescriptions();
        await mcpServer.server.sendToolListChanged();
      }
    } catch { /* best effort */ }
  }

  async function notifyDescriptionsChanged() {
    updateAllDescriptions();
    await mcpServer.server.sendToolListChanged();
  }

  return {
    mcpServer,
    topology: topo,
    updateAllDescriptions,
    notifyDescriptionsChanged,
  };
}
