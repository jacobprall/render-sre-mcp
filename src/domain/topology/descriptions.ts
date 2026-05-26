import { WORKSPACE_RESOURCE_URI } from './workspace-document.js';

export { WORKSPACE_RESOURCE_URI };

/** Static tool descriptions — live inventory is MCP resource render://workspace only. */

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  render_workspace:
    'Inspect one Render resource in depth (plan, region, deploy, connection info). ' +
    `List all resource IDs via MCP resource ${WORKSPACE_RESOURCE_URI}. resourceId is required.`,
  render_observe:
    'Observe a resource: logs, metrics, deploy history, or bundle (all three). resourceId is required. ' +
    `Default mode bundle. Inventory: ${WORKSPACE_RESOURCE_URI}.`,
  render_diagnose:
    'Incident brief for a service or Postgres (logs + deploys + metrics + hypothesis). resourceId is required. ' +
    `Inventory: ${WORKSPACE_RESOURCE_URI}.`,
  render_deploy:
    'Trigger a deploy on a Render service. serviceId is required. ' +
    `Inventory: ${WORKSPACE_RESOURCE_URI}.`,
  render_service:
    'Service actions: restart, run_command, env_vars (list/set), configure (plan/autoscaling). serviceId is required. ' +
    `Inventory: ${WORKSPACE_RESOURCE_URI}.`,
};

export function getToolDescription(toolName: string): string {
  return TOOL_DESCRIPTIONS[toolName] ?? toolName;
}
