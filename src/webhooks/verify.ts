import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_SKEW_SEC = 300;

export interface WebhookSignatureHeaders {
  webhookId: string;
  webhookTimestamp: string;
  webhookSignature: string;
}

export function decodeWebhookSecret(secret: string): Buffer {
  const trimmed = secret.trim();
  if (trimmed.startsWith('whsec_')) {
    return Buffer.from(trimmed.slice(6), 'base64');
  }
  return Buffer.from(trimmed, 'utf8');
}

export function verifyWebhookSignature(
  secret: string,
  body: Buffer | string,
  headers: WebhookSignatureHeaders
): boolean {
  const { webhookId, webhookTimestamp, webhookSignature } = headers;
  if (!webhookId || !webhookTimestamp || !webhookSignature) return false;

  const ts = parseWebhookTimestamp(webhookTimestamp);
  if (ts === null) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > MAX_SKEW_SEC) return false;

  const bodyStr = typeof body === 'string' ? body : body.toString('utf8');
  const signedContent = `${webhookId}.${webhookTimestamp}.${bodyStr}`;
  const key = decodeWebhookSecret(secret);
  const expected = createHmac('sha256', key).update(signedContent).digest('base64');

  for (const part of webhookSignature.split(' ')) {
    const comma = part.indexOf(',');
    if (comma < 0) continue;
    const version = part.slice(0, comma);
    const sig = part.slice(comma + 1);
    if (version !== 'v1' || !sig) continue;
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    } catch {
      /* invalid base64 */
    }
  }
  return false;
}

function parseWebhookTimestamp(raw: string): number | null {
  const asInt = parseInt(raw, 10);
  if (Number.isFinite(asInt) && String(asInt) === raw.trim()) return asInt;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

/** Build a v1 signature for tests and local verification. */
export function signWebhookPayload(
  secret: string,
  body: string,
  webhookId: string,
  webhookTimestamp: string
): string {
  const key = decodeWebhookSecret(secret);
  const signedContent = `${webhookId}.${webhookTimestamp}.${body}`;
  const sig = createHmac('sha256', key).update(signedContent).digest('base64');
  return `v1,${sig}`;
}
