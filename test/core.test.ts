import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RenderAuthError,
  RenderNetworkError,
  RenderRateLimitError,
  RenderTimeoutError,
} from '../src/api/errors.js';
import { validateConfigureRequest } from '../src/configure-allowlist.js';
import { DeployTimelineBuilder } from '../src/deploy-timeline.js';
import { describeTool, BASE_DESCRIPTIONS } from '../src/domain/topology/descriptions.js';
import {
  formatAllResourcesTable,
  formatLogsTable,
  formatServicesTable,
} from '../src/domain/topology/formatTables.js';
import {
  computeHotResourceIds,
  computeHotServiceIds,
  HotResourceTracker,
} from '../src/hot-resources.js';
import { IncidentBriefBuilder } from '../src/incident-brief.js';
import { runWithConcurrency } from '../src/lib/concurrency.js';
import { formatAge } from '../src/lib/time.js';
import { LogProcessor } from '../src/log-processor.js';
import { handleError, errorResult } from '../src/mcp/errors.js';
import {
  configureSchema,
  deploySchema,
  deploysSchema,
  diagnoseSchema,
  envVarsSchema,
  inspectSchema,
  logsSchema,
  metricsSchema,
  restartSchema,
  runCommandSchema,
} from '../src/mcp/schemas.js';
import { TOOL_DEFINITIONS } from '../src/mcp/tool-registry.js';
import { wrapToolHandler } from '../src/mcp/tool-runner.js';
import { MetricsProcessor } from '../src/metrics-processor.js';
import { getResourceName, getResourceType, ID_PREFIX } from '../src/types/resource.js';
import { verifyToken } from '../src/transport/auth.js';
import { logEntry, makeSnapshot } from './helpers/fixtures.js';

describe('configure allowlist', () => {
  it('rejects empty patch', () => {
    const result = validateConfigureRequest({}, false, 'starter');
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /No configuration changes/);
  });

  it('allows tier-1 plan scale-up without confirmation', () => {
    const result = validateConfigureRequest({ plan: 'pro' }, false, 'starter');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.tier, 1);
  });

  it('requires confirmation for plan downgrade', () => {
    const denied = validateConfigureRequest({ plan: 'starter' }, false, 'pro');
    assert.equal(denied.ok, false);

    const allowed = validateConfigureRequest({ plan: 'starter' }, true, 'pro');
    assert.equal(allowed.ok, true);
    if (allowed.ok) assert.equal(allowed.tier, 2);
  });

  it('requires confirmation for autoDeploy yes', () => {
    const denied = validateConfigureRequest({ autoDeploy: 'yes' }, false);
    assert.equal(denied.ok, false);

    const allowed = validateConfigureRequest({ autoDeploy: 'yes' }, true);
    assert.equal(allowed.ok, true);
  });

  it('allows autoDeploy no without confirmation', () => {
    const result = validateConfigureRequest({ autoDeploy: 'no' }, false);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.tier, 1);
  });
});

describe('resource helpers', () => {
  const snapshot = makeSnapshot();

  it('detects resource types by id prefix', () => {
    assert.equal(getResourceType('srv-abc'), 'service');
    assert.equal(getResourceType('dpg-abc'), 'postgres');
    assert.equal(getResourceType('red-abc'), 'keyvalue');
    assert.equal(getResourceType('unknown'), null);
  });

  it('resolves resource names from snapshot', () => {
    assert.equal(getResourceName(snapshot, 'srv-abc123'), 'api');
    assert.equal(getResourceName(snapshot, 'dpg-db1'), 'main-db');
    assert.equal(getResourceName(snapshot, 'red-kv1'), 'cache');
    assert.equal(getResourceName(snapshot, 'srv-missing'), undefined);
  });

  it('exposes stable id prefixes', () => {
    assert.equal(ID_PREFIX.service, 'srv-');
    assert.equal(ID_PREFIX.postgres, 'dpg-');
    assert.equal(ID_PREFIX.keyvalue, 'red-');
  });
});

describe('LogProcessor', () => {
  const processor = new LogProcessor();

  it('normalizes volatile tokens in log lines', () => {
    const line =
      '2024-06-01T12:00:00Z error user=550e8400-e29b-41d4-a716-446655440000 from 10.0.0.1:8080';
    const normalized = processor.normalize(line);
    assert.match(normalized, /\*/);
    assert.doesNotMatch(normalized, /550e8400/);
    assert.doesNotMatch(normalized, /10\.0\.0\.1/);
  });

  it('groups duplicate normalized messages', () => {
    const entries = [
      logEntry('Fatal: connection refused', { level: 'error' }),
      logEntry('Fatal: connection refused', { level: 'error' }),
      logEntry('Warning: retrying', { level: 'warn' }),
    ];
    const patterns = processor.group(entries);
    const fatal = patterns.find(p => p.severity === 'error');
    assert.ok(fatal);
    assert.equal(fatal!.count, 2);
  });

  it('parses HTTP request lines into request summary', () => {
    const entries = [
      logEntry('GET /api/health 200 12.5ms'),
      logEntry('GET /api/users 500 340ms'),
      logEntry('GET /api/users 500 360ms'),
      logEntry('not an http line'),
    ];
    const summary = processor.summarizeRequests(entries);
    assert.ok(summary);
    assert.equal(summary!.total, 3);
    assert.equal(summary!.byStatus['2xx'], 1);
    assert.equal(summary!.byStatus['5xx'], 2);
    assert.equal(summary!.topErrors[0]?.path, '/api/users');
    assert.equal(summary!.topErrors[0]?.count, 2);
  });

  it('parses multiple HTTP requests on a single log line', () => {
    const summary = processor.summarizeRequests([
      logEntry('GET /a 200 1ms GET /b 500 2ms GET /c 404 3ms'),
    ]);
    assert.ok(summary);
    assert.equal(summary!.total, 3);
    assert.equal(summary!.byStatus['2xx'], 1);
    assert.equal(summary!.byStatus['5xx'], 1);
    assert.equal(summary!.byStatus['4xx'], 1);
  });

  it('processes end-to-end summary with signals for error spike', () => {
    const entries = Array.from({ length: 12 }, () =>
      logEntry('Error: database timeout', { level: 'error' })
    );
    const summary = processor.process(entries, 'srv-1', 'svc', {
      start: new Date('2024-01-01T00:00:00Z'),
      end: new Date('2024-01-01T01:00:00Z'),
    });
    assert.ok(summary.signals.some(s => s.includes('Error spike')));
    assert.ok(summary.patterns.some(p => p.severity === 'error'));
  });
});

describe('DeployTimelineBuilder', () => {
  const builder = new DeployTimelineBuilder();

  it('flags regression candidate when errors exist and deploy went live recently', () => {
    const finishedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const timeline = builder.build('srv-1', 'api', [
      {
        id: 'dep-recent',
        status: 'live',
        createdAt: finishedAt,
        finishedAt,
      } as never,
    ], { errorCountInWindow: 3, windowStart: new Date(Date.now() - 60 * 60 * 1000) });

    assert.ok(timeline.entries[0]?.regressionCandidate);
    assert.match(timeline.summary, /regression candidate/i);
  });

  it('does not flag regression without errors in window', () => {
    const finishedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const timeline = builder.build('srv-1', 'api', [
      { id: 'dep-1', status: 'live', createdAt: finishedAt, finishedAt } as never,
    ], { errorCountInWindow: 0 });

    assert.equal(timeline.entries[0]?.regressionCandidate, false);
  });
});

describe('MetricsProcessor', () => {
  const processor = new MetricsProcessor();

  it('emits critical signal when memory exceeds 90% of limit', () => {
    const summary = processor.summarize(
      'srv-1',
      'api',
      { start: new Date('2024-01-01T00:00:00Z'), end: new Date('2024-01-01T01:00:00Z') },
      {
        memory: [{ timestamp: '2024-01-01T00:05:00Z', value: 950 }],
        memoryLimit: [{ timestamp: '2024-01-01T00:05:00Z', value: 1000 }],
      }
    );
    assert.ok(
      summary.signals.some(s => s.severity === 'critical' && s.message.includes('95%'))
    );
    assert.equal(summary.utilization[0]?.pct, 95);
  });

  it('reports info signal when no metrics available', () => {
    const summary = processor.summarize(
      'srv-1',
      'api',
      { start: new Date(), end: new Date() },
      {}
    );
    assert.ok(summary.signals.some(s => s.message.includes('No metrics available')));
  });
});

describe('IncidentBriefBuilder', () => {
  const builder = new IncidentBriefBuilder();
  const snapshot = makeSnapshot();

  it('links errors to recent deploy regression', () => {
    const finishedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const brief = builder.build({
      resourceId: 'srv-abc123',
      resourceName: 'api',
      window: { start: new Date(Date.now() - 3600_000), end: new Date() },
      logs: {
        resourceId: 'srv-abc123',
        resourceName: 'api',
        window: { start: new Date(), end: new Date() },
        patterns: [
          {
            template: 'error *',
            severity: 'error',
            count: 5,
            firstSeen: new Date(),
            lastSeen: new Date(),
            stillActive: true,
            sample: 'ECONNREFUSED postgres',
            correlatedWith: [],
          },
        ],
        requestSummary: null,
        signals: ['Error spike'],
      },
      deploys: {
        serviceId: 'srv-abc123',
        serviceName: 'api',
        summary: 'regression',
        entries: [
          {
            id: 'dep-1',
            status: 'live',
            createdAt: finishedAt,
            finishedAt,
            regressionCandidate: true,
          },
        ],
      },
      metrics: null,
      snapshot,
    });

    assert.equal(brief.confidence, 'medium');
    assert.match(brief.hypothesis, /deploy dep-1/);
    assert.ok(brief.suggestedActions.some(a => a.tool === 'render_deploy'));
    assert.ok(brief.suggestedActions.some(a => a.tool === 'render_inspect'));
  });

  it('format output includes risks section', () => {
    const text = builder.format({
      resourceId: 'srv-1',
      resourceName: 'api',
      window: { start: new Date(), end: new Date() },
      hypothesis: 'test',
      confidence: 'low',
      evidence: [],
      suggestedActions: [],
      risks: ['Low confidence — gather more evidence with drill-down tools.'],
    });
    assert.match(text, /### Risks/);
    assert.match(text, /Low confidence/);
  });
});

describe('topology descriptions and tables', () => {
  const snapshot = makeSnapshot();

  it('includes live resource tables when snapshot is present', () => {
    const desc = describeTool('render_logs', { snapshot, lastRefreshOk: true });
    assert.match(desc, /Resources:/);
    assert.match(desc, /srv-abc123/);
    assert.match(desc, /deployed/);
    assert.match(desc, /Infrastructure state as of \d{2}:\d{2}:\d{2} UTC/);
  });

  it('shows loading message when snapshot missing but refresh ok', () => {
    const desc = describeTool('render_deploy', { snapshot: null, lastRefreshOk: true });
    assert.match(desc, /Loading infrastructure state/);
  });

  it('shows API unreachable message when refresh failed', () => {
    const desc = describeTool('render_deploy', { snapshot: null, lastRefreshOk: false });
    assert.match(desc, /Unable to reach Render API/);
  });

  it('formatServicesTable omits URLs when includeUrl is false', () => {
    const table = formatServicesTable(snapshot, false);
    assert.doesNotMatch(table, /oregon/);
    assert.match(table, /srv-abc123/);
  });

  it('formatLogsTable includes postgres and redis rows', () => {
    const table = formatLogsTable(snapshot);
    assert.match(table, /dpg-db1/);
    assert.match(table, /red-kv1/);
  });

  it('formatAllResourcesTable lists all resource kinds', () => {
    const table = formatAllResourcesTable(snapshot);
    assert.match(table, /postgres/);
    assert.match(table, /redis/);
  });

  it('registers a description for every MCP tool', () => {
    for (const def of TOOL_DEFINITIONS) {
      assert.ok(BASE_DESCRIPTIONS[def.name], `missing base description for ${def.name}`);
    }
  });
});

describe('hot resources', () => {
  it('marks suspended services as hot', () => {
    const snapshot = makeSnapshot({
      services: [
        {
          id: 'srv-susp',
          name: 'paused',
          type: 'web_service',
          suspended: 'suspended',
        } as never,
      ],
    });
    const hot = computeHotServiceIds(snapshot, new HotResourceTracker());
    assert.ok(hot.has('srv-susp'));
  });

  it('tracks recently acted-on resources', () => {
    const tracker = new HotResourceTracker(60_000);
    tracker.markActedOn('srv-xyz');
    assert.ok(tracker.isActedOn('srv-xyz'));
    assert.deepEqual(tracker.getActedOnIds(), ['srv-xyz']);
  });

  it('includes unhealthy databases in hot resource set', () => {
    const snapshot = makeSnapshot({
      databases: [
        {
          id: 'dpg-down',
          name: 'down',
          status: 'unavailable',
        } as never,
      ],
    });
    const hot = computeHotResourceIds(snapshot, new HotResourceTracker());
    assert.ok(hot.has('dpg-down'));
  });
});

describe('MCP schemas', () => {
  it('parses deploy tool args with defaults', () => {
    const parsed = deploySchema.parse({ serviceId: 'srv-1' });
    assert.equal(parsed.clearCache, false);
  });

  it('parses logs tool args with defaults', () => {
    const parsed = logsSchema.parse({ resourceId: 'srv-1' });
    assert.equal(parsed.raw, false);
  });

  it('parses env vars set action', () => {
    const parsed = envVarsSchema.parse({
      serviceId: 'srv-1',
      action: 'set',
      vars: { NODE_ENV: 'production' },
    });
    assert.equal(parsed.action, 'set');
    assert.equal(parsed.vars?.NODE_ENV, 'production');
  });

  it('registers exactly ten tools with unique names', () => {
    assert.equal(TOOL_DEFINITIONS.length, 10);
    const names = TOOL_DEFINITIONS.map(d => d.name);
    assert.equal(new Set(names).size, names.length);
    for (const schema of [
      inspectSchema,
      restartSchema,
      runCommandSchema,
      deploysSchema,
      metricsSchema,
      diagnoseSchema,
      configureSchema,
    ]) {
      assert.ok(schema);
    }
  });
});

describe('MCP error handling', () => {
  it('maps RenderAuthError to auth message', () => {
    const result = handleError(new RenderAuthError('Unauthorized'));
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /authentication failed/i);
  });

  it('maps network and timeout errors', () => {
    assert.match(handleError(new RenderNetworkError('Connection reset')).content[0]!.text, /unreachable/i);
    assert.match(handleError(new RenderTimeoutError('Request timed out', 30_000)).content[0]!.text, /unreachable/i);
  });

  it('maps rate limit by class and status text', () => {
    assert.match(handleError(new RenderRateLimitError('Too many requests')).content[0]!.text, /rate limit/i);
    assert.match(handleError(new Error('HTTP 429')).content[0]!.text, /rate limit/i);
  });

  it('errorResult sets isError flag', () => {
    const result = errorResult('boom');
    assert.equal(result.isError, true);
    assert.equal(result.content[0]!.text, 'boom');
  });
});

describe('tool runner', () => {
  it('returns error when topology snapshot is unavailable', async () => {
    const topo = {
      ensureFresh: async () => {},
      snapshot: null,
    };
    const handler = wrapToolHandler(
      { topo: topo as never, hotTracker: new HotResourceTracker(), refreshAndNotify: () => {} },
      { resourceIdField: 'serviceId' },
      async () => ({ content: [{ type: 'text', text: 'ok' }] })
    );
    const result = await handler({ serviceId: 'srv-1' });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /not available/);
  });

  it('marks hot resource and refreshes on success when configured', async () => {
    const snapshot = makeSnapshot();
    const hotTracker = new HotResourceTracker();
    let refreshed = false;
    const topo = {
      ensureFresh: async () => {},
      snapshot,
    };
    const handler = wrapToolHandler(
      {
        topo: topo as never,
        hotTracker,
        refreshAndNotify: () => {
          refreshed = true;
        },
      },
      { resourceIdField: 'serviceId', refreshOnSuccess: true },
      async () => ({ content: [{ type: 'text', text: 'deployed' }] })
    );
    const result = await handler({ serviceId: 'srv-abc123' });
    assert.equal(result.isError, undefined);
    assert.ok(hotTracker.isActedOn('srv-abc123'));
    assert.ok(refreshed);
  });

  it('refreshes topology when shouldRefresh returns true', async () => {
    const snapshot = makeSnapshot();
    let refreshed = false;
    const topo = { ensureFresh: async () => {}, snapshot };
    const handler = wrapToolHandler(
      {
        topo: topo as never,
        hotTracker: new HotResourceTracker(),
        refreshAndNotify: () => {
          refreshed = true;
        },
      },
      {
        resourceIdField: 'serviceId',
        shouldRefresh: (args) => args.action === 'set',
      },
      async () => ({ content: [{ type: 'text', text: 'ok' }] })
    );
    await handler({ serviceId: 'srv-abc123', action: 'set' });
    assert.ok(refreshed);

    refreshed = false;
    await handler({ serviceId: 'srv-abc123', action: 'list' });
    assert.equal(refreshed, false);
  });

  it('maps handler exceptions through handleError', async () => {
    const topo = {
      ensureFresh: async () => {},
      snapshot: makeSnapshot(),
    };
    const handler = wrapToolHandler(
      { topo: topo as never, hotTracker: new HotResourceTracker(), refreshAndNotify: () => {} },
      { resourceIdField: 'serviceId' },
      async () => {
        throw new Error('boom');
      }
    );
    const result = await handler({ serviceId: 'srv-abc123' });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /boom/);
  });
});

describe('keyValue normalize', () => {
  it('fills missing fields omitted by the API', async () => {
    const { normalizeKeyValue } = await import('../src/api/keyValue.js');
    const kv = normalizeKeyValue({
      id: 'red-abc',
      name: 'cache',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-06-01T00:00:00Z',
      region: 'oregon',
      plan: 'starter',
      status: 'available',
      owner: { id: 'own-1', name: 'team' },
      ipAllowList: null,
    });
    assert.equal(kv.maxmemoryPolicy, 'noeviction');
    assert.equal(kv.suspended, 'not_suspended');
    assert.deepEqual(kv.suspenders, []);
    assert.equal(kv.ipAllowList, undefined);
    assert.equal(kv.dashboardUrl, '');
  });
});

describe('lib utilities', () => {
  it('formatAge returns human-readable relative times', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    assert.match(formatAge(fiveMinAgo), /5m ago/);
    assert.equal(formatAge(new Date(Date.now() + 60_000).toISOString()), '?');
  });

  it('runWithConcurrency executes all tasks', async () => {
    const order: number[] = [];
    const tasks = [0, 1, 2, 3].map(n => async () => {
      order.push(n);
      return n;
    });
    const results = await runWithConcurrency(tasks, 2);
    assert.deepEqual(results.sort(), [0, 1, 2, 3]);
    assert.equal(order.length, 4);
  });

  it('verifyToken uses timing-safe comparison', () => {
    assert.equal(verifyToken('secret-token', 'secret-token'), true);
    assert.equal(verifyToken('wrong', 'secret-token'), false);
    assert.equal(verifyToken('short', 'much-longer-token'), false);
  });
});
