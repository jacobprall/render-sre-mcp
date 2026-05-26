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
  const pollInterval = 3_000;
  const start = Date.now();
  let current = job;

  while (Date.now() - start < maxWait) {
    if (current.status === 'succeeded' || current.status === 'failed') break;
    await new Promise(r => setTimeout(r, pollInterval));
    current = await api.retrieveJob(args.serviceId, current.id);
  }

  const lines: string[] = [
    `## Command: ${args.command}`,
    `Service: ${name} (${args.serviceId})`,
    `Job ID: ${current.id}`,
    `Status: ${current.status}`,
  ];

  if (current.startedAt) lines.push(`Started: ${current.startedAt}`);
  if (current.finishedAt) lines.push(`Finished: ${current.finishedAt}`);

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
