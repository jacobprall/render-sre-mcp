import { z } from 'zod';

export const workspaceSchema = z.object({
  resourceId: z.string().describe('Resource ID (srv-, dpg-, or red- prefix)'),
});

export const observeSchema = z.object({
  resourceId: z.string().describe('Service, Postgres, or Key-Value ID'),
  mode: z
    .enum(['bundle', 'logs', 'metrics', 'deploys'])
    .optional()
    .default('bundle')
    .describe('bundle = logs + deploys + metrics summary; or single signal type'),
  raw: z.boolean().optional().default(false).describe('Raw logs/metrics output where supported'),
  severity: z.enum(['error', 'warning', 'info']).optional().describe('Log severity (logs mode, raw)'),
  startTime: z.string().optional().describe('ISO 8601 window start'),
  endTime: z.string().optional().describe('ISO 8601 window end'),
  search: z.string().optional().describe('Log text filter (logs mode, raw)'),
  limit: z.number().optional().describe('Max log lines (logs mode, raw) or deploy count (deploys mode)'),
  windowMinutes: z.number().optional().describe('Window for bundle mode (default 60)'),
});

export const diagnoseSchema = z.object({
  resourceId: z.string().describe('Service or Postgres ID'),
  symptom: z.string().optional().describe('Optional symptom description from user'),
  windowMinutes: z.number().optional().describe('Investigation window in minutes (default 60)'),
});

export const deploySchema = z.object({
  serviceId: z.string().describe('Service ID to deploy'),
  clearCache: z.boolean().optional().default(false).describe('Clear build cache before deploying'),
});

export const serviceSchema = z.object({
  serviceId: z.string().describe('Service ID'),
  action: z
    .enum(['restart', 'run_command', 'env_vars', 'configure'])
    .describe('restart | run_command | env_vars | configure'),
  command: z.string().optional().describe('Command for run_command'),
  envAction: z
    .enum(['list', 'set'])
    .optional()
    .default('list')
    .describe('For env_vars: list or set'),
  reveal: z.boolean().optional().default(false).describe('Reveal env values on list'),
  vars: z.record(z.string(), z.string()).optional().describe('Env vars to set'),
  confirmed: z.boolean().optional().default(false).describe('Required for risky configure changes'),
  plan: z.string().optional().describe('Service plan (configure)'),
  autoDeploy: z.enum(['yes', 'no']).optional().describe('Auto-deploy (configure)'),
  healthCheckPath: z.string().optional().describe('Health check path (configure)'),
  numInstances: z.number().optional().describe('Instance count (configure)'),
});
