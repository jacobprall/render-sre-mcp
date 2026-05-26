import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { TopologyCache } from './topology.js';
import type { ToolCallResult } from './types.js';
import { RenderAuthError, RenderNetworkError, RenderTimeoutError, RenderRateLimitError } from './render-api.js';
import { getHotResourceTracker } from './hot-resources.js';
import { handleDeploy } from './tools/deploy.js';
import { handleLogs } from './tools/logs.js';
import { handleEnvVars } from './tools/env-vars.js';
import { handleInspect } from './tools/inspect.js';
import { handleRestart } from './tools/restart.js';
import { handleRunCommand } from './tools/run-command.js';
import { handleDeploys } from './tools/deploys.js';
import { handleMetrics } from './tools/metrics.js';
import { handleDiagnose } from './tools/diagnose.js';
import { handleConfigure } from './tools/configure.js';

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

  function updateAllDescriptions() {
    for (const [name, reg] of registeredTools) {
      reg.update({ description: topo.describe(name) });
    }
  }

  const registeredTools = new Map<string, ReturnType<typeof mcpServer.registerTool>>();

  registeredTools.set('render_deploy', mcpServer.registerTool(
    'render_deploy',
    {
      description: topo.describe('render_deploy'),
      inputSchema: z.object({
        serviceId: z.string().describe('Service ID to deploy'),
        clearCache: z.boolean().optional().default(false).describe('Clear build cache before deploying'),
      }),
    },
    async ({ serviceId, clearCache }) => {
      await topo.ensureFresh();
      const snapshot = topo.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        const result = await handleDeploy({ serviceId, clearCache }, snapshot);
        hotTracker.markActedOn(serviceId);
        refreshAndNotify();
        return result;
      } catch (err: unknown) {
        return handleError(err);
      }
    }
  ));

  registeredTools.set('render_logs', mcpServer.registerTool(
    'render_logs',
    {
      description: topo.describe('render_logs'),
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
      await topo.ensureFresh();
      const snapshot = topo.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        const result = await handleLogs(args, snapshot);
        hotTracker.markActedOn(args.resourceId);
        return result;
      } catch (err: unknown) {
        return handleError(err);
      }
    }
  ));

  registeredTools.set('render_env_vars', mcpServer.registerTool(
    'render_env_vars',
    {
      description: topo.describe('render_env_vars'),
      inputSchema: z.object({
        serviceId: z.string().describe('Service ID'),
        action: z.enum(['list', 'set']).optional().default('list').describe('List current env vars or set new values'),
        reveal: z.boolean().optional().default(false).describe('Show actual values instead of masked (list action only)'),
        vars: z.record(z.string(), z.string()).optional().describe('Key-value pairs to set (set action only)'),
      }),
    },
    async (args) => {
      await topo.ensureFresh();
      const snapshot = topo.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        const envArgs = {
          serviceId: args.serviceId,
          action: args.action as 'list' | 'set' | undefined,
          reveal: args.reveal,
          vars: args.vars as Record<string, string> | undefined,
        };
        const result = await handleEnvVars(envArgs, snapshot);
        hotTracker.markActedOn(args.serviceId);
        if (args.action === 'set') refreshAndNotify();
        return result;
      } catch (err: unknown) {
        return handleError(err);
      }
    }
  ));

  registeredTools.set('render_inspect', mcpServer.registerTool(
    'render_inspect',
    {
      description: topo.describe('render_inspect'),
      inputSchema: z.object({
        resourceId: z.string().describe('Resource ID to inspect'),
      }),
    },
    async ({ resourceId }) => {
      await topo.ensureFresh();
      const snapshot = topo.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        const result = await handleInspect({ resourceId }, snapshot);
        hotTracker.markActedOn(resourceId);
        return result;
      } catch (err: unknown) {
        return handleError(err);
      }
    }
  ));

  registeredTools.set('render_restart', mcpServer.registerTool(
    'render_restart',
    {
      description: topo.describe('render_restart'),
      inputSchema: z.object({
        serviceId: z.string().describe('Service ID to restart'),
      }),
    },
    async ({ serviceId }) => {
      await topo.ensureFresh();
      const snapshot = topo.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        const result = await handleRestart({ serviceId }, snapshot);
        hotTracker.markActedOn(serviceId);
        refreshAndNotify();
        return result;
      } catch (err: unknown) {
        return handleError(err);
      }
    }
  ));

  registeredTools.set('render_run_command', mcpServer.registerTool(
    'render_run_command',
    {
      description: topo.describe('render_run_command'),
      inputSchema: z.object({
        serviceId: z.string().describe('Service to run the command on'),
        command: z.string().describe("Command to execute (e.g., 'npx prisma migrate deploy')"),
      }),
    },
    async ({ serviceId, command }) => {
      await topo.ensureFresh();
      const snapshot = topo.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        const result = await handleRunCommand({ serviceId, command }, snapshot);
        hotTracker.markActedOn(serviceId);
        return result;
      } catch (err: unknown) {
        return handleError(err);
      }
    }
  ));

  registeredTools.set('render_deploys', mcpServer.registerTool(
    'render_deploys',
    {
      description: topo.describe('render_deploys'),
      inputSchema: z.object({
        serviceId: z.string().describe('Service ID'),
        limit: z.number().optional().describe('Number of deploys (default 10, max 20)'),
      }),
    },
    async ({ serviceId, limit }) => {
      await topo.ensureFresh();
      const snapshot = topo.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        const result = await handleDeploys({ serviceId, limit }, snapshot);
        hotTracker.markActedOn(serviceId);
        return result;
      } catch (err: unknown) {
        return handleError(err);
      }
    }
  ));

  registeredTools.set('render_metrics', mcpServer.registerTool(
    'render_metrics',
    {
      description: topo.describe('render_metrics'),
      inputSchema: z.object({
        resourceId: z.string().describe('Service, Postgres, or Key-Value ID'),
        startTime: z.string().optional().describe('ISO 8601 start (default: 1h ago)'),
        endTime: z.string().optional().describe('ISO 8601 end (default: now)'),
        raw: z.boolean().optional().default(false).describe('Return raw JSON metric series'),
      }),
    },
    async (args) => {
      await topo.ensureFresh();
      const snapshot = topo.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        const result = await handleMetrics(args, snapshot);
        hotTracker.markActedOn(args.resourceId);
        return result;
      } catch (err: unknown) {
        return handleError(err);
      }
    }
  ));

  registeredTools.set('render_diagnose', mcpServer.registerTool(
    'render_diagnose',
    {
      description: topo.describe('render_diagnose'),
      inputSchema: z.object({
        resourceId: z.string().describe('Service or Postgres ID'),
        symptom: z.string().optional().describe('Optional symptom description from user'),
        windowMinutes: z.number().optional().describe('Investigation window in minutes (default 60)'),
      }),
    },
    async (args) => {
      await topo.ensureFresh();
      const snapshot = topo.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        const result = await handleDiagnose(args, snapshot);
        hotTracker.markActedOn(args.resourceId);
        return result;
      } catch (err: unknown) {
        return handleError(err);
      }
    }
  ));

  registeredTools.set('render_configure', mcpServer.registerTool(
    'render_configure',
    {
      description: topo.describe('render_configure'),
      inputSchema: z.object({
        serviceId: z.string().describe('Service ID'),
        confirmed: z.boolean().optional().default(false).describe('Required true for Tier 2 risky changes'),
        plan: z.string().optional().describe('Service plan'),
        autoDeploy: z.enum(['yes', 'no']).optional().describe('Auto-deploy setting'),
        healthCheckPath: z.string().optional().describe('HTTP health check path'),
        numInstances: z.number().optional().describe('Instance count'),
      }),
    },
    async (args) => {
      await topo.ensureFresh();
      const snapshot = topo.snapshot;
      if (!snapshot) return errorResult('Render infrastructure state not available.');
      try {
        const result = await handleConfigure(args, snapshot);
        hotTracker.markActedOn(args.serviceId);
        refreshAndNotify();
        return result;
      } catch (err: unknown) {
        return handleError(err);
      }
    }
  ));

  return mcpServer;
}

function errorResult(message: string): ToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function handleError(err: unknown): ToolCallResult {
  if (err instanceof RenderAuthError) {
    return errorResult('Render API authentication failed. Check that RENDER_API_KEY is valid and has sufficient permissions.');
  }
  if (err instanceof RenderNetworkError || err instanceof RenderTimeoutError) {
    return errorResult('Render API unreachable. Cannot complete this operation. Please try again later.');
  }
  if (err instanceof RenderRateLimitError) {
    return errorResult('Render API rate limit exceeded. Please wait a moment and try again.');
  }

  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('401') || message.includes('Unauthorized')) {
    return errorResult('Render API authentication failed. Check that RENDER_API_KEY is valid and has sufficient permissions.');
  }
  if (message.includes('429')) {
    return errorResult('Render API rate limit exceeded. Please wait a moment and try again.');
  }
  return errorResult(`Error: ${message}`);
}
