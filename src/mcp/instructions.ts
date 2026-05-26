import { WORKSPACE_RESOURCE_URI } from '../domain/topology/workspace-document.js';

export const SERVER_INSTRUCTIONS = `Render SRE MCP — workspace operations for AI agents.

## Discover resources
Read MCP resource \`${WORKSPACE_RESOURCE_URI}\` for the current service/postgres/redis inventory and IDs.
Do not guess resource IDs.

## Typical workflows
- **Debug**: render_observe(resourceId, mode: bundle) or render_diagnose(resourceId)
- **Ship**: render_deploy(serviceId) then render_observe(resourceId, mode: logs) to verify
- **Detail**: render_workspace(resourceId) for full resource config
- **Ops**: render_service(serviceId, action: …) for restart, env vars, migrations, plan changes

## Rules
- Always pass explicit serviceId or resourceId (no server-side focus or defaults).
- Prefer render_observe mode bundle over separate observe calls when investigating issues.
- render_service configure tier-2 changes require confirmed:true and user approval.`;
