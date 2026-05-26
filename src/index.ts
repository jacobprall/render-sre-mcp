#!/usr/bin/env node

import { TopologyCache } from './topology.js';
import { createServer } from './server.js';

async function startStdio() {
  const { StdioServerTransport } = await import('@modelcontextprotocol/server');
  const topology = new TopologyCache();
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

async function startHttp(port: number) {
  const express = (await import('express')).default;
  const { WebStandardStreamableHTTPServerTransport } = await import('@modelcontextprotocol/server');

  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey) {
    console.error('RENDER_API_KEY is required for HTTP mode');
    process.exit(1);
  }

  const app = express();

  app.use('/mcp', (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Authorization header. Use: Bearer <RENDER_API_KEY>' });
      return;
    }
    const token = authHeader.slice(7);
    if (token !== apiKey) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }
    next();
  });

  const topology = new TopologyCache();
  const mcpServer = await createServer(topology);

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
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
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
      duplex: 'half',
    } as any);

    const webRes = await transport.handleRequest(webReq);

    res.status(webRes.status);
    webRes.headers.forEach((value, key) => res.setHeader(key, value));

    if (webRes.body) {
      const reader = (webRes.body as ReadableStream).getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); break; }
          res.write(value);
        }
      };
      pump().catch(() => res.end());
    } else {
      res.end(await webRes.text());
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', mode: 'http' });
  });

  app.listen(port, () => {
    console.log(`render-mcp-server started (HTTP mode on port ${port})`);
    console.log(`MCP endpoint: http://localhost:${port}/mcp`);
  });
}

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : null;
if (port) {
  startHttp(port);
} else {
  startStdio();
}
