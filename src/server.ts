import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { TopologyCache } from './topology.js';
import type { ToolCallResult } from './types.js';
import { handleDeploy } from './tools/deploy.js';
import { handleLogs } from './tools/logs.js';
import { handleEnvVars } from './tools/env-vars.js';
import { handleInspect } from './tools/inspect.js';
import { handleRestart } from './tools/restart.js';
import { handleRunCommand } from './tools/run-command.js';

const DEBOUNCE_MS = 5_000;

export async function createServer(topology: TopologyCache) {
  await topology.ensureFresh();

  const mcpServer = new McpServer(
    { name: 'render-mcp-server', version: '0.1.0' },
    { capabilities: { tools: { listChanged: true } } }
  );

  let lastNotification = 0;

  async function refreshAndNotify() {
    try {
      const changed = await topology.refresh();
      if (changed && Date.now() - lastNotification > DEBOUNCE_MS) {
        lastNotification = Date.now();
        updateAllDescriptions();
        await mcpServer.server.sendToolListChanged();
      }
    } catch { /* best effort */ }
  }

  function updateAllDescriptions() {
    for (const [name, reg] of registeredTools) {
      reg.update({ description: topology.describe(name) });
    }
  }

  const registeredTools = new Map<string, ReturnType<typeof mcpServer.registerTool>>();

  registeredTools.set('render_deploy', mcpServer.registerTool(
    'render_deploy',
    {
      description: topology.describe('render_deploy'),
      inputSchema: z.object({
        serviceId: z.string().describe('Service ID to deploy'),
        clearCache: z.boolean().optional().default(false).describe('Clear build cache before deploying'),
      }),
    },
    async ({ serviceId, clearCache }) => {
      await topology.ensureFresh();
      const snapshot = topology.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        const result = await handleDeploy({ serviceId, clearCache }, snapshot);
        refreshAndNotify();
        return result;
      } catch (err: any) {
        return handleError(err);
      }
    }
  ));

  registeredTools.set('render_logs', mcpServer.registerTool(
    'render_logs',
    {
      description: topology.describe('render_logs'),
      inputSchema: z.object({
        resourceId: z.string().describe('Resource ID to get logs from'),
        raw: z.boolean().optional().default(false).describe('Return unprocessed log lines instead of summary'),
        severity: z.enum(['error', 'warning', 'info']).optional().describe('Filter by severity (raw mode only)'),
        startTime: z.string().optional().describe('Start of time window (ISO 8601). Default: 10 minutes ago'),
        endTime: z.string().optional().describe('End of time window (ISO 8601). Default: now'),
        search: z.string().optional().describe('Text search filter (raw mode only)'),
        limit: z.number().optional().describe('Max lines to return (raw mode only, default: 100)'),
      }),
    },
    async (args) => {
      await topology.ensureFresh();
      const snapshot = topology.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        return await handleLogs(args, snapshot);
      } catch (err: any) {
        return handleError(err);
      }
    }
  ));

  registeredTools.set('render_env_vars', mcpServer.registerTool(
    'render_env_vars',
    {
      description: topology.describe('render_env_vars'),
      inputSchema: z.object({
        serviceId: z.string().describe('Service ID'),
        action: z.enum(['list', 'set']).optional().default('list').describe('List current env vars or set new values'),
        reveal: z.boolean().optional().default(false).describe('Show actual values instead of masked (list action only)'),
        vars: z.record(z.string(), z.string()).optional().describe('Key-value pairs to set (set action only)'),
      }),
    },
    async (args) => {
      await topology.ensureFresh();
      const snapshot = topology.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        const envArgs = {
          serviceId: args.serviceId,
          action: args.action as 'list' | 'set' | undefined,
          reveal: args.reveal,
          vars: args.vars as Record<string, string> | undefined,
        };
        const result = await handleEnvVars(envArgs, snapshot);
        if (args.action === 'set') refreshAndNotify();
        return result;
      } catch (err: any) {
        return handleError(err);
      }
    }
  ));

  registeredTools.set('render_inspect', mcpServer.registerTool(
    'render_inspect',
    {
      description: topology.describe('render_inspect'),
      inputSchema: z.object({
        resourceId: z.string().describe('Resource ID to inspect'),
      }),
    },
    async ({ resourceId }) => {
      await topology.ensureFresh();
      const snapshot = topology.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        return await handleInspect({ resourceId }, snapshot);
      } catch (err: any) {
        return handleError(err);
      }
    }
  ));

  registeredTools.set('render_restart', mcpServer.registerTool(
    'render_restart',
    {
      description: topology.describe('render_restart'),
      inputSchema: z.object({
        serviceId: z.string().describe('Service ID to restart'),
      }),
    },
    async ({ serviceId }) => {
      await topology.ensureFresh();
      const snapshot = topology.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        const result = await handleRestart({ serviceId }, snapshot);
        refreshAndNotify();
        return result;
      } catch (err: any) {
        return handleError(err);
      }
    }
  ));

  registeredTools.set('render_run_command', mcpServer.registerTool(
    'render_run_command',
    {
      description: topology.describe('render_run_command'),
      inputSchema: z.object({
        serviceId: z.string().describe('Service to run the command on'),
        command: z.string().describe("Command to execute (e.g., 'npx prisma migrate deploy')"),
      }),
    },
    async ({ serviceId, command }) => {
      await topology.ensureFresh();
      const snapshot = topology.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        return await handleRunCommand({ serviceId, command }, snapshot);
      } catch (err: any) {
        return handleError(err);
      }
    }
  ));

  return mcpServer;
}

function errorResult(message: string): ToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function handleError(err: any): ToolCallResult {
  const message = err?.message ?? String(err);
  const name = err?.constructor?.name ?? '';

  if (name === 'RenderAuthError' || message.includes('401') || message.includes('Unauthorized')) {
    return errorResult('Render API authentication failed. Check that RENDER_API_KEY is valid and has sufficient permissions.');
  }
  if (name === 'RenderNetworkError' || name === 'RenderTimeoutError') {
    return errorResult('Render API unreachable. Cannot complete this operation. Please try again later.');
  }
  if (name === 'RenderRateLimitError' || message.includes('429')) {
    return errorResult('Render API rate limit exceeded. Please wait a moment and try again.');
  }
  return errorResult(`Error: ${message}`);
}
