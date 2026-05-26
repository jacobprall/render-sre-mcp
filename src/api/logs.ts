import { getApiKey, getOwnerId } from './client.js';

export interface LogEntry {
  id: string;
  message: string;
  timestamp: string;
  labels: Array<{ name: string; value: string }>;
}

export async function fetchServiceLogs(
  resourceId: string,
  options?: {
    startTime?: string;
    endTime?: string;
    severity?: 'debug' | 'info' | 'warn' | 'error';
    limit?: number;
    direction?: 'forward' | 'backward';
  }
): Promise<LogEntry[]> {
  const key = getApiKey();
  const ownerId = await getOwnerId();
  const params = new URLSearchParams();
  params.set('ownerId', ownerId);
  params.set('resource', resourceId);
  params.set('limit', String(options?.limit ?? 500));
  params.set('direction', options?.direction ?? 'backward');
  if (options?.startTime) params.set('startTime', options.startTime);
  if (options?.endTime) params.set('endTime', options.endTime);
  if (options?.severity) params.set('severity', options.severity);

  const resp = await fetch(`https://api.render.com/v1/logs?${params}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) {
    const body = await resp.text();
    const truncated = body.length > 200 ? body.slice(0, 200) + '…' : body;
    throw new Error(`Logs API error (${resp.status}): ${truncated}`);
  }
  const data = await resp.json() as { logs: LogEntry[] };
  return data.logs ?? [];
}
