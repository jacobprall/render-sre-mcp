import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { HotResourceTracker } from '../hot-resources.js';
import type { TopologyCache } from '../domain/topology/cache.js';
import type { ToolCallResult, TopologySnapshot } from '../types.js';
import { handleConfigure } from '../tools/configure.js';
import { handleDeploy } from '../tools/deploy.js';
import { handleDeploys } from '../tools/deploys.js';
import { handleDiagnose } from '../tools/diagnose.js';
import { handleEnvVars } from '../tools/env-vars.js';
import { handleInspect } from '../tools/inspect.js';
import { handleLogs } from '../tools/logs.js';
import { handleMetrics } from '../tools/metrics.js';
import { handleRestart } from '../tools/restart.js';
import { handleRunCommand } from '../tools/run-command.js';
import {
  configureSchema,
  deploySchema,
  deploysSchema,
  diagnoseSchema,
  envVarsSchema,
  inspectSchema,
  logsSchema,
  metricsSchema,
  restartSchema,
  runCommandSchema,
} from './schemas.js';
import { wrapToolHandler, type ToolRunnerContext } from './tool-runner.js';

type ZodObjectSchema = z.ZodObject<z.ZodRawShape>;

export interface ToolDefinition<TSchema extends ZodObjectSchema = ZodObjectSchema> {
  name: string;
  inputSchema: TSchema;
  resourceIdField: 'serviceId' | 'resourceId';
  refreshOnSuccess?: boolean;
  shouldRefresh?: (args: z.infer<TSchema>) => boolean;
  mapArgs?: (args: z.infer<TSchema>) => z.infer<TSchema>;
  handler: (args: z.infer<TSchema>, snapshot: TopologySnapshot) => Promise<ToolCallResult>;
}

function defineTool<TSchema extends ZodObjectSchema>(def: ToolDefinition<TSchema>): ToolDefinition<TSchema> {
  return def;
}

export const TOOL_DEFINITIONS = [
  defineTool({
    name: 'render_deploy',
    inputSchema: deploySchema,
    resourceIdField: 'serviceId',
    refreshOnSuccess: true,
    handler: (args, snapshot) => handleDeploy(args, snapshot),
  }),
  defineTool({
    name: 'render_logs',
    inputSchema: logsSchema,
    resourceIdField: 'resourceId',
    handler: (args, snapshot) => handleLogs(args, snapshot),
  }),
  defineTool({
    name: 'render_env_vars',
    inputSchema: envVarsSchema,
    resourceIdField: 'serviceId',
    shouldRefresh: (args) => args.action === 'set',
    mapArgs: (args) => ({
      serviceId: args.serviceId,
      action: args.action,
      reveal: args.reveal,
      vars: args.vars,
    }),
    handler: (args, snapshot) => handleEnvVars(args, snapshot),
  }),
  defineTool({
    name: 'render_inspect',
    inputSchema: inspectSchema,
    resourceIdField: 'resourceId',
    handler: (args, snapshot) => handleInspect(args, snapshot),
  }),
  defineTool({
    name: 'render_restart',
    inputSchema: restartSchema,
    resourceIdField: 'serviceId',
    refreshOnSuccess: true,
    handler: (args, snapshot) => handleRestart(args, snapshot),
  }),
  defineTool({
    name: 'render_run_command',
    inputSchema: runCommandSchema,
    resourceIdField: 'serviceId',
    handler: (args, snapshot) => handleRunCommand(args, snapshot),
  }),
  defineTool({
    name: 'render_deploys',
    inputSchema: deploysSchema,
    resourceIdField: 'serviceId',
    handler: (args, snapshot) => handleDeploys(args, snapshot),
  }),
  defineTool({
    name: 'render_metrics',
    inputSchema: metricsSchema,
    resourceIdField: 'resourceId',
    handler: (args, snapshot) => handleMetrics(args, snapshot),
  }),
  defineTool({
    name: 'render_diagnose',
    inputSchema: diagnoseSchema,
    resourceIdField: 'resourceId',
    handler: (args, snapshot) => handleDiagnose(args, snapshot),
  }),
  defineTool({
    name: 'render_configure',
    inputSchema: configureSchema,
    resourceIdField: 'serviceId',
    refreshOnSuccess: true,
    handler: (args, snapshot) => handleConfigure(args, snapshot),
  }),
];

export function registerTools(
  mcpServer: McpServer,
  topo: TopologyCache,
  hotTracker: HotResourceTracker,
  refreshAndNotify: () => void
): Map<string, ReturnType<McpServer['registerTool']>> {
  const runnerCtx: ToolRunnerContext = { topo, hotTracker, refreshAndNotify };
  const registered = new Map<string, ReturnType<McpServer['registerTool']>>();

  for (const def of TOOL_DEFINITIONS) {
    const wrapped = wrapToolHandler(
      runnerCtx,
      {
        resourceIdField: def.resourceIdField,
        refreshOnSuccess: def.refreshOnSuccess,
        shouldRefresh: def.shouldRefresh as
          | ((args: Record<string, unknown>) => boolean)
          | undefined,
        mapArgs: def.mapArgs as
          | ((args: Record<string, unknown>) => Record<string, unknown>)
          | undefined,
      },
      def.handler as (
        args: Record<string, unknown>,
        snapshot: TopologySnapshot
      ) => Promise<ToolCallResult>
    );

    registered.set(
      def.name,
      mcpServer.registerTool(
        def.name,
        {
          description: topo.describe(def.name),
          inputSchema: def.inputSchema,
        },
        wrapped
      )
    );
  }

  return registered;
}
