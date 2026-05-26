import { McpServer } from '@modelcontextprotocol/server';
import { getHotResourceTracker } from '../hot-resources.js';
import { TopologyCache } from '../domain/topology/cache.js';
import { registerTools } from './tool-registry.js';

const DEBOUNCE_MS = 5_000;

export async function createServer(topology?: TopologyCache) {
  const hotTracker = getHotResourceTracker();
  const topo = topology ?? new TopologyCache(hotTracker);
  await topo.ensureFresh();

  const mcpServer = new McpServer(
    { name: 'render-mcp-server', version: '0.2.0' },
    { capabilities: { tools: { listChanged: true } } }
  );

  let lastNotification = 0;

  async function refreshAndNotify() {
    try {
      const changed = await topo.refresh();
      if (changed && Date.now() - lastNotification > DEBOUNCE_MS) {
        lastNotification = Date.now();
        updateAllDescriptions();
        await mcpServer.server.sendToolListChanged();
      }
    } catch { /* best effort */ }
  }

  const registeredTools = registerTools(mcpServer, topo, hotTracker, () => {
    void refreshAndNotify();
  });

  function updateAllDescriptions() {
    for (const [name, reg] of registeredTools) {
      reg.update({ description: topo.describe(name) });
    }
  }

  return mcpServer;
}
