import type { TopologySnapshot, ToolCallResult } from '../types.js';
import { handleConfigure } from './configure.js';
import { handleEnvVars } from './env-vars.js';
import { handleRestart } from './restart.js';
import { handleRunCommand } from './run-command.js';

export type ServiceAction = 'restart' | 'run_command' | 'env_vars' | 'configure';

export async function handleService(
  args: {
    serviceId: string;
    action: ServiceAction;
    command?: string;
    envAction?: 'list' | 'set';
    reveal?: boolean;
    vars?: Record<string, string>;
    confirmed?: boolean;
    plan?: string;
    autoDeploy?: 'yes' | 'no';
    healthCheckPath?: string;
    numInstances?: number;
  },
  snapshot: TopologySnapshot
): Promise<ToolCallResult> {
  switch (args.action) {
    case 'restart':
      return handleRestart({ serviceId: args.serviceId }, snapshot);
    case 'run_command':
      if (!args.command) {
        return {
          content: [{ type: 'text', text: 'command is required for run_command.' }],
          isError: true,
        };
      }
      return handleRunCommand({ serviceId: args.serviceId, command: args.command }, snapshot);
    case 'env_vars':
      return handleEnvVars(
        {
          serviceId: args.serviceId,
          action: args.envAction ?? 'list',
          reveal: args.reveal,
          vars: args.vars,
        },
        snapshot
      );
    case 'configure':
      return handleConfigure(
        {
          serviceId: args.serviceId,
          confirmed: args.confirmed,
          plan: args.plan,
          autoDeploy: args.autoDeploy,
          healthCheckPath: args.healthCheckPath,
          numInstances: args.numInstances,
        },
        snapshot
      );
    default:
      return {
        content: [{ type: 'text', text: `Unknown action: ${String(args.action)}` }],
        isError: true,
      };
  }
}
