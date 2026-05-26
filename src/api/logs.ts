import type { LogEntry } from '../types/render-api.js';
import { getOwnerId, renderGet } from './http.js';

export type { LogEntry };

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
  const ownerId = await getOwnerId();
  const query: Record<string, string> = {
    ownerId,
    resource: resourceId,
    limit: String(options?.limit ?? 500),
    direction: options?.direction ?? 'backward',
  };
  if (options?.startTime) query.startTime = options.startTime;
  if (options?.endTime) query.endTime = options.endTime;
  if (options?.severity) query.severity = options.severity;

  const data = await renderGet<{ logs: LogEntry[] }>('/logs', query);
  return data.logs ?? [];
}
