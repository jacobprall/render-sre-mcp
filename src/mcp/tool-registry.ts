import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { HotResourceTracker } from '../hot-resources.js';
import type { TopologyCache } from '../domain/topology/cache.js';
import { getToolDescription } from '../domain/topology/descriptions.js';
import type { ToolCallResult, TopologySnapshot } from '../types.js';
import { handleDeploy } from '../tools/deploy.js';
import { handleDiagnose } from '../tools/diagnose.js';
import { handleObserve } from '../tools/observe.js';
import { handleInspect } from '../tools/inspect.js';
import { handleService } from '../tools/service.js';
import {
  deploySchema,
  diagnoseSchema,
  observeSchema,
  serviceSchema,
  workspaceSchema,
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
    name: 'render_workspace',
    inputSchema: workspaceSchema,
    resourceIdField: 'resourceId',
    handler: (args, snapshot) => handleInspect(args, snapshot),
  }),
  defineTool({
    name: 'render_observe',
    inputSchema: observeSchema,
    resourceIdField: 'resourceId',
    handler: (args, snapshot) => handleObserve(args, snapshot),
  }),
  defineTool({
    name: 'render_diagnose',
    inputSchema: diagnoseSchema,
    resourceIdField: 'resourceId',
    handler: (args, snapshot) => handleDiagnose(args, snapshot),
  }),
  defineTool({
    name: 'render_deploy',
    inputSchema: deploySchema,
    resourceIdField: 'serviceId',
    refreshOnSuccess: true,
    handler: (args, snapshot) => handleDeploy(args, snapshot),
  }),
  defineTool({
    name: 'render_service',
    inputSchema: serviceSchema,
    resourceIdField: 'serviceId',
    refreshOnSuccess: true,
    shouldRefresh: (args) => args.action === 'env_vars' && args.envAction === 'set',
    handler: (args, snapshot) => handleService(args, snapshot),
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
          description: getToolDescription(def.name),
          inputSchema: def.inputSchema,
        },
        wrapped
      )
    );
  }

  return registered;
}
