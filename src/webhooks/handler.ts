import type { Request, Response } from 'express';
import type { TopologyCache } from '../domain/topology/cache.js';
import { mapWebhookToDeployHint, parseWebhookPayload } from './map-event.js';
import { verifyWebhookSignature } from './verify.js';

export interface WebhookHandlerOptions {
  secret: string;
  topology: TopologyCache;
  notifyDescriptionsChanged: () => void;
  debounceMs?: number;
}

export function createWebhookHandler(options: WebhookHandlerOptions) {
  const { secret, topology, notifyDescriptionsChanged, debounceMs = 2000 } = options;
  let notifyTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleNotify() {
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      notifyDescriptionsChanged();
    }, debounceMs);
  }

  return (req: Request, res: Response) => {
    if (!topology.snapshot) {
      res.sendStatus(503);
      return;
    }

    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      res.sendStatus(400);
      return;
    }

    const webhookId = headerString(req.headers['webhook-id']);
    const webhookTimestamp = headerString(req.headers['webhook-timestamp']);
    const webhookSignature = headerString(req.headers['webhook-signature']);

    if (
      !verifyWebhookSignature(secret, rawBody, {
        webhookId,
        webhookTimestamp,
        webhookSignature,
      })
    ) {
      res.sendStatus(401);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.sendStatus(400);
      return;
    }

    const payload = parseWebhookPayload(parsed);
    if (!payload) {
      res.sendStatus(400);
      return;
    }

    const hint = mapWebhookToDeployHint(payload);
    if (!hint) {
      res.sendStatus(204);
      return;
    }

    const result = topology.applyDeployEvent(payload.data.serviceId, hint, payload.data.id);
    if (result === 'unknown_service') {
      process.stderr.write(
        `Webhook: unknown service ${payload.data.serviceId} (${payload.type})\n`
      );
      res.sendStatus(204);
      return;
    }

    if (result === 'duplicate') {
      res.sendStatus(204);
      return;
    }

    scheduleNotify();
    res.sendStatus(204);
  };
}

function headerString(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return '';
}
