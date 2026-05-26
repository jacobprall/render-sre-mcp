import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  signWebhookPayload,
  verifyWebhookSignature,
} from '../../src/webhooks/verify.js';

const SECRET = 'test-webhook-secret';
const BODY = JSON.stringify({
  type: 'deploy_started',
  timestamp: '2026-05-26T12:00:00.000Z',
  data: { id: 'evt-test', serviceId: 'srv-abc123', serviceName: 'api' },
});

describe('verifyWebhookSignature', () => {
  it('accepts valid signatures', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const id = 'msg-test-1';
    const sig = signWebhookPayload(SECRET, BODY, id, ts);
    assert.equal(
      verifyWebhookSignature(SECRET, BODY, {
        webhookId: id,
        webhookTimestamp: ts,
        webhookSignature: sig,
      }),
      true
    );
  });

  it('rejects invalid signatures', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    assert.equal(
      verifyWebhookSignature(SECRET, BODY, {
        webhookId: 'msg-test-2',
        webhookTimestamp: ts,
        webhookSignature: 'v1,invalid',
      }),
      false
    );
  });

  it('rejects expired timestamps', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 600);
    const id = 'msg-test-3';
    const sig = signWebhookPayload(SECRET, BODY, id, ts);
    assert.equal(
      verifyWebhookSignature(SECRET, BODY, {
        webhookId: id,
        webhookTimestamp: ts,
        webhookSignature: sig,
      }),
      false
    );
  });
});
