import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mapWebhookToDeployHint,
  normalizeDeployStatus,
  parseWebhookPayload,
} from '../../src/webhooks/map-event.js';

describe('mapWebhookToDeployHint', () => {
  it('maps deploy_started to in-progress status', () => {
    const hint = mapWebhookToDeployHint({
      type: 'deploy_started',
      timestamp: new Date().toISOString(),
      data: { id: 'evt-1', serviceId: 'srv-a' },
    });
    assert.ok(hint);
    assert.equal(hint.status, 'update_in_progress');
    assert.equal(hint.deployId, 'evt-1');
  });

  it('maps build_started to build_in_progress', () => {
    const hint = mapWebhookToDeployHint({
      type: 'build_started',
      timestamp: new Date().toISOString(),
      data: { id: 'evt-2', serviceId: 'srv-a' },
    });
    assert.ok(hint);
    assert.equal(hint.status, 'build_in_progress');
  });

  it('maps deploy_ended with succeeded to live', () => {
    const hint = mapWebhookToDeployHint({
      type: 'deploy_ended',
      timestamp: new Date().toISOString(),
      data: { id: 'evt-3', serviceId: 'srv-a', status: 'succeeded' },
    });
    assert.ok(hint);
    assert.equal(hint.status, 'live');
  });

  it('maps build_ended with build_failed', () => {
    const hint = mapWebhookToDeployHint({
      type: 'build_ended',
      timestamp: new Date().toISOString(),
      data: { id: 'evt-4', serviceId: 'srv-a', status: 'build_failed' },
    });
    assert.ok(hint);
    assert.equal(hint.status, 'build_failed');
  });

  it('returns null for unknown event types', () => {
    const hint = mapWebhookToDeployHint({
      type: 'scaling_started',
      timestamp: new Date().toISOString(),
      data: { id: 'evt-5', serviceId: 'srv-a' },
    });
    assert.equal(hint, null);
  });
});

describe('normalizeDeployStatus', () => {
  it('normalizes succeeded to live', () => {
    assert.equal(normalizeDeployStatus('succeeded'), 'live');
  });

  it('returns unknown for empty', () => {
    assert.equal(normalizeDeployStatus(), 'unknown');
  });
});

describe('parseWebhookPayload', () => {
  it('rejects malformed payloads', () => {
    assert.equal(parseWebhookPayload(null), null);
    assert.equal(parseWebhookPayload({ type: 'x' }), null);
  });

  it('parses valid payloads', () => {
    const p = parseWebhookPayload({
      type: 'deploy_started',
      timestamp: '2026-05-26T00:00:00Z',
      data: { id: 'evt-1', serviceId: 'srv-abc' },
    });
    assert.ok(p);
    assert.equal(p.data.serviceId, 'srv-abc');
  });
});
