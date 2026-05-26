import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { TopologyCache } from '../../src/domain/topology/cache.js';
import { HotResourceTracker } from '../../src/hot-resources.js';
import { createWebhookHandler } from '../../src/webhooks/handler.js';
import { signWebhookPayload } from '../../src/webhooks/verify.js';
import { makeSnapshot } from '../helpers/fixtures.js';

const SECRET = 'handler-test-secret';

function invokeHandler(
  handler: ReturnType<typeof createWebhookHandler>,
  opts: {
    body: string;
    headers?: Record<string, string>;
    rawBody?: Buffer;
  }
): Promise<number> {
  return new Promise(resolve => {
    const raw = opts.rawBody ?? Buffer.from(opts.body, 'utf8');
    const req = {
      body: raw,
      headers: opts.headers ?? {},
    } as Request;

    const res = {
      statusCode: 200,
      sendStatus(code: number) {
        this.statusCode = code;
        resolve(code);
      },
    } as Response & { statusCode: number };

    handler(req, res);
  });
}

function signedHeaders(body: string, id: string, ts: string) {
  return {
    'webhook-id': id,
    'webhook-timestamp': ts,
    'webhook-signature': signWebhookPayload(SECRET, body, id, ts),
  };
}

describe('createWebhookHandler', () => {
  it('applies deploy event and schedules notify', async () => {
    const cache = new TopologyCache(new HotResourceTracker());
    cache.snapshot = makeSnapshot();
    let notifyCount = 0;

    const handler = createWebhookHandler({
      secret: SECRET,
      topology: cache,
      notifyDescriptionsChanged: () => {
        notifyCount++;
      },
      debounceMs: 10,
    });

    const body = JSON.stringify({
      type: 'deploy_started',
      timestamp: new Date().toISOString(),
      data: { id: 'evt-h1', serviceId: 'srv-abc123', serviceName: 'api' },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const status = await invokeHandler(handler, {
      body,
      headers: signedHeaders(body, 'evt-h1', ts),
    });

    assert.equal(status, 204);
    assert.equal(cache.snapshot.deployHints.get('srv-abc123')?.status, 'update_in_progress');

    await new Promise(r => setTimeout(r, 30));
    assert.ok(notifyCount >= 1);
  });

  it('returns 401 for unsigned payloads', async () => {
    const cache = new TopologyCache(new HotResourceTracker());
    cache.snapshot = makeSnapshot();
    let notifyCount = 0;

    const handler = createWebhookHandler({
      secret: SECRET,
      topology: cache,
      notifyDescriptionsChanged: () => {
        notifyCount++;
      },
    });

    const body = JSON.stringify({
      type: 'deploy_started',
      timestamp: new Date().toISOString(),
      data: { id: 'evt-h2', serviceId: 'srv-abc123' },
    });
    const status = await invokeHandler(handler, {
      body,
      headers: { 'webhook-signature': 'v1,bad' },
    });

    assert.equal(status, 401);
    assert.equal(notifyCount, 0);
    assert.equal(cache.snapshot.deployHints.get('srv-abc123')?.status, 'live');
  });

  it('ignores duplicate event ids', async () => {
    const cache = new TopologyCache(new HotResourceTracker());
    cache.snapshot = makeSnapshot();
    let notifyCount = 0;

    const handler = createWebhookHandler({
      secret: SECRET,
      topology: cache,
      notifyDescriptionsChanged: () => {
        notifyCount++;
      },
      debounceMs: 10,
    });

    const ts = String(Math.floor(Date.now() / 1000));
    const body1 = JSON.stringify({
      type: 'deploy_started',
      timestamp: new Date().toISOString(),
      data: { id: 'evt-dup-h', serviceId: 'srv-abc123' },
    });
    await invokeHandler(handler, {
      body: body1,
      headers: signedHeaders(body1, 'evt-dup-h', ts),
    });

    const body2 = JSON.stringify({
      type: 'deploy_ended',
      timestamp: new Date().toISOString(),
      data: { id: 'evt-dup-h', serviceId: 'srv-abc123', status: 'live' },
    });
    const status = await invokeHandler(handler, {
      body: body2,
      headers: signedHeaders(body2, 'evt-dup-h', ts),
    });

    assert.equal(status, 204);
    assert.equal(cache.snapshot.deployHints.get('srv-abc123')?.status, 'update_in_progress');
    await new Promise(r => setTimeout(r, 30));
    assert.equal(notifyCount, 1);
  });

  it('returns 400 for malformed JSON', async () => {
    const cache = new TopologyCache(new HotResourceTracker());
    cache.snapshot = makeSnapshot();

    const handler = createWebhookHandler({
      secret: SECRET,
      topology: cache,
      notifyDescriptionsChanged: () => {},
    });

    const body = '{not json';
    const ts = String(Math.floor(Date.now() / 1000));
    const status = await invokeHandler(handler, {
      body,
      headers: signedHeaders(body, 'evt-bad-json', ts),
    });
    assert.equal(status, 400);
  });

  it('returns 204 for unknown event types without cache change', async () => {
    const cache = new TopologyCache(new HotResourceTracker());
    cache.snapshot = makeSnapshot();
    const before = cache.snapshot.deployHints.get('srv-abc123')?.status;

    const handler = createWebhookHandler({
      secret: SECRET,
      topology: cache,
      notifyDescriptionsChanged: () => {},
    });

    const body = JSON.stringify({
      type: 'scaling_started',
      timestamp: new Date().toISOString(),
      data: { id: 'evt-scale', serviceId: 'srv-abc123' },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const status = await invokeHandler(handler, {
      body,
      headers: signedHeaders(body, 'evt-scale', ts),
    });

    assert.equal(status, 204);
    assert.equal(cache.snapshot.deployHints.get('srv-abc123')?.status, before);
  });
});
