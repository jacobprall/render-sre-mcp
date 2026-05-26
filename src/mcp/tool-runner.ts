import type { HotResourceTracker } from '../hot-resources.js';
import type { TopologyCache } from '../domain/topology/cache.js';
import type { ToolCallResult, TopologySnapshot } from '../types.js';
import { errorResult, handleError } from './errors.js';

export interface ToolRunnerContext {
  topo: TopologyCache;
  hotTracker: HotResourceTracker;
  refreshAndNotify: () => void;
}

export interface ToolRunnerOptions {
  resourceIdField: 'serviceId' | 'resourceId';
  refreshOnSuccess?: boolean;
  shouldRefresh?: (args: Record<string, unknown>) => boolean;
  mapArgs?: (args: Record<string, unknown>) => Record<string, unknown>;
}

export function wrapToolHandler(
  ctx: ToolRunnerContext,
  options: ToolRunnerOptions,
  handler: (
    args: Record<string, unknown>,
    snapshot: TopologySnapshot
  ) => Promise<ToolCallResult>
): (args: Record<string, unknown>) => Promise<ToolCallResult> {
  return async (args: Record<string, unknown>) => {
    await ctx.topo.ensureFresh();
    const snapshot = ctx.topo.snapshot;
    if (!snapshot) {
      return errorResult('Render infrastructure state not available.');
    }
    try {
      const mapped = options.mapArgs ? options.mapArgs(args) : args;
      const result = await handler(mapped, snapshot);
      const resourceId = args[options.resourceIdField];
      if (typeof resourceId === 'string') {
        ctx.hotTracker.markActedOn(resourceId);
      }
      if (options.refreshOnSuccess || options.shouldRefresh?.(args)) {
        ctx.refreshAndNotify();
      }
      return result;
    } catch (err: unknown) {
      return handleError(err);
    }
  };
}
