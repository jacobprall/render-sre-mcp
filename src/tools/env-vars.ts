import * as api from '../render-api.js';
import type { TopologySnapshot, ToolCallResult } from '../types.js';
import { getResourceName } from '../types.js';

export async function handleEnvVars(
  args: {
    serviceId: string;
    action?: 'list' | 'set';
    reveal?: boolean;
    vars?: Record<string, string>;
  },
  snapshot: TopologySnapshot
): Promise<ToolCallResult> {
  const name = getResourceName(snapshot, args.serviceId) ?? args.serviceId;
  const action = args.action ?? 'list';

  if (action === 'list') {
    const vars = await api.fetchEnvVars(args.serviceId);
    const lines = vars.map(v => {
      const val = args.reveal ? v.value : '****';
      return `${v.key} = ${val}`;
    });
    return {
      content: [{
        type: 'text',
        text: `Environment variables for ${name} (${args.serviceId}):\n${lines.join('\n')}\n(${vars.length} total)`,
      }],
    };
  }

  if (action === 'set' && args.vars) {
    const entries = Object.entries(args.vars);
    if (entries.length === 0) {
      return {
        content: [{ type: 'text', text: 'No variables provided to set.' }],
        isError: true,
      };
    }
    await api.setEnvVars(args.serviceId, args.vars);
    const lines = entries.map(([k, v]) => `  ${k} (length=${v.length})`);
    return {
      content: [{
        type: 'text',
        text: [
          `Set ${entries.length} env var${entries.length === 1 ? '' : 's'} on ${name} (${args.serviceId}):`,
          ...lines,
          '',
          'Note: Changes take effect on next deploy. Run render_deploy to apply now.',
        ].join('\n'),
      }],
    };
  }

  return {
    content: [{ type: 'text', text: 'Invalid action or missing vars for set action.' }],
    isError: true,
  };
}
