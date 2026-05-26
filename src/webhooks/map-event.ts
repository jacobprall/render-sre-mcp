import { formatAge } from '../lib/time.js';
import type { DeployHint } from '../types/topology.js';

export interface RenderWebhookPayload {
  type: string;
  timestamp: string;
  data: {
    id: string;
    serviceId: string;
    serviceName?: string;
    status?: string;
  };
}

const IN_PROGRESS_TYPES = new Set(['deploy_started', 'build_started']);
const TERMINAL_TYPES = new Set(['deploy_ended', 'build_ended']);

/** Returns null when the event type should be acknowledged without cache mutation. */
export function mapWebhookToDeployHint(payload: RenderWebhookPayload): DeployHint | null {
  const { type, timestamp, data } = payload;
  const ageLabel = formatAge(timestamp);

  if (IN_PROGRESS_TYPES.has(type)) {
    return {
      ageLabel,
      status: type === 'build_started' ? 'build_in_progress' : 'update_in_progress',
      deployId: data.id,
    };
  }

  if (TERMINAL_TYPES.has(type)) {
    return {
      ageLabel,
      status: normalizeDeployStatus(data.status),
      deployId: data.id,
    };
  }

  return null;
}

export function normalizeDeployStatus(status?: string): string {
  if (!status) return 'unknown';
  const s = status.trim().toLowerCase();
  if (s === 'succeeded') return 'live';
  return s;
}

export function parseWebhookPayload(body: unknown): RenderWebhookPayload | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  const data = root.data;
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof root.type !== 'string' || typeof root.timestamp !== 'string') return null;
  if (typeof d.serviceId !== 'string' || typeof d.id !== 'string') return null;
  return {
    type: root.type,
    timestamp: root.timestamp,
    data: {
      id: d.id,
      serviceId: d.serviceId,
      serviceName: typeof d.serviceName === 'string' ? d.serviceName : undefined,
      status: typeof d.status === 'string' ? d.status : undefined,
    },
  };
}
