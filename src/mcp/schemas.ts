import { z } from 'zod';

export const deploySchema = z.object({
  serviceId: z.string().describe('Service ID to deploy'),
  clearCache: z.boolean().optional().default(false).describe('Clear build cache before deploying'),
});

export const logsSchema = z.object({
  resourceId: z.string().describe('Resource ID to get logs from'),
  raw: z.boolean().optional().default(false).describe('Return unprocessed log lines instead of summary'),
  severity: z.enum(['error', 'warning', 'info']).optional().describe('Filter by severity (raw mode only)'),
  startTime: z.string().optional().describe('Start of time window (ISO 8601). Default: 10 minutes ago'),
  endTime: z.string().optional().describe('End of time window (ISO 8601). Default: now'),
  search: z.string().optional().describe('Text search filter (raw mode only)'),
  limit: z.number().optional().describe('Max lines to return (raw mode only, default: 100)'),
});

export const envVarsSchema = z.object({
  serviceId: z.string().describe('Service ID'),
  action: z.enum(['list', 'set']).optional().default('list').describe('List current env vars or set new values'),
  reveal: z.boolean().optional().default(false).describe('Show actual values instead of masked (list action only)'),
  vars: z.record(z.string(), z.string()).optional().describe('Key-value pairs to set (set action only)'),
});

export const inspectSchema = z.object({
  resourceId: z.string().describe('Resource ID to inspect'),
});

export const restartSchema = z.object({
  serviceId: z.string().describe('Service ID to restart'),
});

export const runCommandSchema = z.object({
  serviceId: z.string().describe('Service to run the command on'),
  command: z.string().describe("Command to execute (e.g., 'npx prisma migrate deploy')"),
});

export const deploysSchema = z.object({
  serviceId: z.string().describe('Service ID'),
  limit: z.number().optional().describe('Number of deploys (default 10, max 20)'),
});

export const metricsSchema = z.object({
  resourceId: z.string().describe('Service, Postgres, or Key-Value ID'),
  startTime: z.string().optional().describe('ISO 8601 start (default: 1h ago)'),
  endTime: z.string().optional().describe('ISO 8601 end (default: now)'),
  raw: z.boolean().optional().default(false).describe('Return raw JSON metric series'),
});

export const diagnoseSchema = z.object({
  resourceId: z.string().describe('Service or Postgres ID'),
  symptom: z.string().optional().describe('Optional symptom description from user'),
  windowMinutes: z.number().optional().describe('Investigation window in minutes (default 60)'),
});

export const configureSchema = z.object({
  serviceId: z.string().describe('Service ID'),
  confirmed: z.boolean().optional().default(false).describe('Required true for Tier 2 risky changes'),
  plan: z.string().optional().describe('Service plan'),
  autoDeploy: z.enum(['yes', 'no']).optional().describe('Auto-deploy setting'),
  healthCheckPath: z.string().optional().describe('HTTP health check path'),
  numInstances: z.number().optional().describe('Instance count'),
});
