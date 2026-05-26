import { TopologyCache } from '../domain/topology/cache.js';
import { createServer } from '../mcp/server.js';
import { getHotResourceTracker } from '../hot-resources.js';

export async function startStdio(): Promise<void> {
  const { StdioServerTransport } = await import('@modelcontextprotocol/server');
  const hotTracker = getHotResourceTracker();
  const topology = new TopologyCache(hotTracker);
  const mcpServer = await createServer(topology);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  process.stderr.write('render-mcp-server started (stdio mode)\n');

  const shutdown = async () => {
    await mcpServer.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
