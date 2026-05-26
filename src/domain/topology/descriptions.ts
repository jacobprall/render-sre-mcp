import type { TopologySnapshot } from '../../types/topology.js';
import {
  formatAllResourcesTable,
  formatEnvVarsTable,
  formatLogsTable,
  formatServicesTable,
} from './formatTables.js';

export const BASE_DESCRIPTIONS: Record<string, string> = {
  render_deploy: 'Trigger a deploy on a Render service.',
  render_logs:
    'Retrieve and analyze logs from a Render resource. Returns a processed summary by default (deduplicated errors, patterns, correlations). Pass raw: true for unprocessed lines.',
  render_env_vars: 'Read or set environment variables on a Render service.',
  render_inspect:
    'Get detailed information about any Render resource — plan, region, last deploy, crash details, connection info.',
  render_restart: 'Restart a running service without triggering a full deploy (no rebuild).',
  render_run_command:
    "Execute a one-off command in a service's environment (e.g., migrations, seed scripts).",
  render_deploys:
    'Recent deployment history for a service (timeline summary, regression flags within 30m of live).',
  render_metrics:
    'Performance metrics summary (peaks vs limits, trends). Pass raw: true for JSON series.',
  render_diagnose:
    'One-shot incident brief: logs + deploy timeline + metrics. Suggests next tools.',
  render_configure:
    'Update service platform config (not env vars). Tier 1: safe changes immediate. Tier 2: requires confirmed:true AND user approval in chat first.',
};

export interface DescribeContext {
  snapshot: TopologySnapshot | null;
  lastRefreshOk: boolean;
}

export function describeTool(toolName: string, ctx: DescribeContext): string {
  const base = BASE_DESCRIPTIONS[toolName];
  if (!base) return toolName;
  if (!ctx.snapshot) {
    if (!ctx.lastRefreshOk) {
      return base + '\n\n(Unable to reach Render API — will retry on next call.)';
    }
    return base + '\n\n(Loading infrastructure state...)';
  }

  switch (toolName) {
    case 'render_deploy':
    case 'render_restart':
    case 'render_run_command':
    case 'render_deploys':
    case 'render_configure':
      return base + '\n\n' + formatServicesTable(ctx.snapshot, false);

    case 'render_logs':
    case 'render_diagnose':
      return base + '\n\n' + formatLogsTable(ctx.snapshot);

    case 'render_env_vars':
      return base + '\n\n' + formatEnvVarsTable(ctx.snapshot);

    case 'render_inspect':
    case 'render_metrics':
      return base + '\n\n' + formatAllResourcesTable(ctx.snapshot);

    default:
      return base;
  }
}
