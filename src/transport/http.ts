import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { getHotResourceTracker } from '../hot-resources.js';
import { createServer } from '../mcp/server.js';
import { TopologyCache } from '../domain/topology/cache.js';
import { verifyToken } from './auth.js';

export async function startHttp(port: number): Promise<void> {
  const express = (await import('express')).default;
  const { WebStandardStreamableHTTPServerTransport } = await import('@modelcontextprotocol/server');

  const config = loadConfig();
  const authToken = config.mcpAuthToken ?? config.renderApiKey;
  if (!authToken) {
    console.error('MCP_AUTH_TOKEN or RENDER_API_KEY is required for HTTP mode');
    process.exit(1);
  }

  const app = express();

  app.use('/mcp', (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Authorization header. Use: Bearer <token>' });
      return;
    }
    const token = authHeader.slice(7);
    if (!verifyToken(token, authToken)) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    next();
  });

  const hotTracker = getHotResourceTracker();
  const topology = new TopologyCache(hotTracker);
  const mcpServer = await createServer(topology);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(transport);

  app.all('/mcp', async (req, res) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(key, value);
      else if (Array.isArray(value)) value.forEach(v => headers.append(key, v));
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const webReq = new Request(url, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : (req as unknown as BodyInit),
      duplex: 'half',
    } as RequestInit);

    const webRes = await transport.handleRequest(webReq);

    res.status(webRes.status);
    webRes.headers.forEach((value, key) => res.setHeader(key, value));

    if (webRes.body) {
      const reader = (webRes.body as ReadableStream).getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const canContinue = res.write(value);
          if (!canContinue) {
            await new Promise<void>(resolve => res.once('drain', resolve));
          }
        }
      } catch (err) {
        process.stderr.write(`Stream error: ${err instanceof Error ? err.message : err}\n`);
      } finally {
        res.end();
      }
    } else {
      res.end(await webRes.text());
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', mode: 'http' });
  });

  const httpServer = app.listen(port, () => {
    console.log(`render-mcp-server started (HTTP mode on port ${port})`);
    console.log(`MCP endpoint: http://localhost:${port}/mcp`);
  });

  const shutdown = async () => {
    console.log('Shutting down...');
    httpServer.close();
    await mcpServer.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
