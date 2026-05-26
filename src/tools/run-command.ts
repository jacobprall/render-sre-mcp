import * as api from '../render-api.js';
import type { TopologySnapshot, ToolCallResult } from '../types.js';
import { getResourceName } from '../types.js';

export async function handleRunCommand(
  args: { serviceId: string; command: string },
  snapshot: TopologySnapshot
): Promise<ToolCallResult> {
  const name = getResourceName(snapshot, args.serviceId) ?? args.serviceId;
  const job = await api.createJob(args.serviceId, args.command);

  const maxWait = 120_000;
  const start = Date.now();
  let current = job;
  let pollInterval = 3_000;

  while (Date.now() - start < maxWait) {
    if (current.status === 'succeeded' || current.status === 'failed') break;
    await new Promise(r => setTimeout(r, pollInterval));
    current = await api.retrieveJob(args.serviceId, current.id);
    pollInterval = Math.min(pollInterval * 1.5, 10_000);
  }

  const timedOut = current.status !== 'succeeded' && current.status !== 'failed';

  const lines: string[] = [
    `## Command: ${args.command}`,
    `Service: ${name} (${args.serviceId})`,
    `Job ID: ${current.id}`,
    `Status: ${current.status}`,
  ];

  if (current.startedAt) lines.push(`Started: ${current.startedAt}`);
  if (current.finishedAt) lines.push(`Finished: ${current.finishedAt}`);

  if (timedOut) {
    lines.push('');
    lines.push('⚠ Agent polling timed out after 120s. The job is still running on Render.');
    lines.push('Check status in the Render Dashboard or call render_workspace later.');
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
