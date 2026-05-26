import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TopologyCache } from '../../src/domain/topology/cache.js';
import { HotResourceTracker } from '../../src/hot-resources.js';
import { makeSnapshot } from '../helpers/fixtures.js';

describe('TopologyCache.applyDeployEvent', () => {
  it('patches deploy hint for known service', () => {
    const cache = new TopologyCache(new HotResourceTracker());
    cache.snapshot = makeSnapshot();
    const before = cache.snapshot.fetchedAt;

    const result = cache.applyDeployEvent(
      'srv-abc123',
      { ageLabel: 'just now', status: 'build_in_progress', deployId: 'evt-1' },
      'evt-1'
    );

    assert.equal(result, 'applied');
    const hint = cache.snapshot.deployHints.get('srv-abc123');
    assert.equal(hint?.status, 'build_in_progress');
    assert.ok(cache.snapshot.fetchedAt >= before);
  });

  it('returns unknown_service for missing service id', () => {
    const cache = new TopologyCache(new HotResourceTracker());
    cache.snapshot = makeSnapshot();
    const result = cache.applyDeployEvent(
      'srv-unknown',
      { ageLabel: 'now', status: 'live' },
      'evt-2'
    );
    assert.equal(result, 'unknown_service');
  });

  it('deduplicates same event id within window', () => {
    const cache = new TopologyCache(new HotResourceTracker());
    cache.snapshot = makeSnapshot();
    const first = cache.applyDeployEvent(
      'srv-abc123',
      { ageLabel: 'a', status: 'build_in_progress' },
      'evt-dup'
    );
    const second = cache.applyDeployEvent(
      'srv-abc123',
      { ageLabel: 'b', status: 'live' },
      'evt-dup'
    );
    assert.equal(first, 'applied');
    assert.equal(second, 'duplicate');
    assert.equal(cache.snapshot.deployHints.get('srv-abc123')?.status, 'build_in_progress');
  });
});
