import type { DeployTimeline, IncidentBrief, LogSummary, MetricsSummary, SuggestedAction, TopologySnapshot } from './types.js';
import { getResourceType } from './types.js';

const DB_ERROR_RE = /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connection refused|too many clients|postgres|database)\b/i;

export class IncidentBriefBuilder {
  build(opts: {
    resourceId: string;
    resourceName: string;
    window: { start: Date; end: Date };
    symptom?: string;
    logs: LogSummary | null;
    logsFormatted?: string;
    deploys: DeployTimeline | null;
    metrics: MetricsSummary | null;
    snapshot: TopologySnapshot;
  }): IncidentBrief {
    const { resourceId, resourceName, window, symptom, logs, logsFormatted, deploys, metrics, snapshot } = opts;

    const regression = deploys?.entries.find(e => e.regressionCandidate);
    const errorPatterns = logs?.patterns.filter(p => p.severity === 'error') ?? [];
    const hasErrors = errorPatterns.length > 0 || (logs?.signals.length ?? 0) > 0;

    let hypothesis = 'No dominant failure pattern in the selected window.';
    let confidence: IncidentBrief['confidence'] = 'low';

    if (regression && hasErrors) {
      hypothesis = `Errors may be related to deploy ${regression.id} (${regression.status}) within the last 30 minutes.`;
      confidence = 'medium';
    } else if (regression) {
      hypothesis = `Recent deploy ${regression.id} finished ${regression.status}; monitor for regressions.`;
      confidence = 'low';
    } else if (hasErrors) {
      hypothesis = errorPatterns[0]?.sample.slice(0, 120) ?? 'Errors detected in logs.';
      confidence = 'medium';
    } else if (metrics?.signals.some(s => s.severity !== 'info')) {
      hypothesis = metrics.signals.find(s => s.severity !== 'info')?.message ?? 'Resource pressure detected.';
      confidence = 'medium';
    }

    if (symptom) {
      hypothesis = `${hypothesis} (User report: ${symptom})`;
    }

    const evidence = this.buildEvidence(logs, logsFormatted, deploys, metrics);
    const suggestedActions = this.buildActions(resourceId, resourceName, logs, deploys, metrics, snapshot);
    const risks = [
      'Correlation does not prove root cause — verify before production changes.',
      ...(confidence === 'low' ? ['Low confidence — gather more evidence with drill-down tools.'] : []),
    ];

    return {
      resourceId,
      resourceName,
      window,
      hypothesis,
      confidence,
      evidence,
      suggestedActions,
      risks,
    };
  }

  format(brief: IncidentBrief, maxLines = 40): string {
    const risksSection = this.formatRisks(brief.risks);
    const reservedLines = risksSection.split('\n').length + 2;

    const lines: string[] = [
      `## Diagnosis: ${brief.resourceName} (${brief.resourceId})`,
      `Window: ${brief.window.start.toISOString().slice(11, 19)} – ${brief.window.end.toISOString().slice(11, 19)}`,
      '',
      `### Likely cause (${brief.confidence} confidence)`,
      brief.hypothesis,
      '',
    ];

    for (const block of brief.evidence) {
      lines.push(`### ${block.title}`, block.body, '');
    }

    if (brief.suggestedActions.length > 0) {
      lines.push('### Suggested next actions');
      for (const a of brief.suggestedActions) {
        const confirm = a.requiresConfirmation ? ' (requires user confirmation)' : '';
        lines.push(`- **${a.tool}**: ${a.description}${confirm}`);
      }
      lines.push('');
    }

    const bodyLines = lines.length;
    if (bodyLines + reservedLines > maxLines) {
      const truncatedBody = lines.slice(0, maxLines - reservedLines);
      truncatedBody.push('… (evidence truncated)', '');
      return truncatedBody.join('\n') + risksSection;
    }

    return lines.join('\n') + risksSection;
  }

  private formatRisks(risks: string[]): string {
    const lines = ['### Risks'];
    for (const r of risks) lines.push(`- ${r}`);
    return lines.join('\n');
  }

  private buildEvidence(
    logs: LogSummary | null,
    logsFormatted: string | undefined,
    deploys: DeployTimeline | null,
    metrics: MetricsSummary | null
  ) {
    const blocks = [];
    if (logs) {
      if (logsFormatted) {
        blocks.push({ title: 'Logs', body: logsFormatted });
      } else {
        const errCount = logs.patterns.filter(p => p.severity === 'error').reduce((s, p) => s + p.count, 0);
        blocks.push({
          title: 'Logs',
          body: `${errCount} error pattern(s); ${logs.signals.slice(0, 3).join('; ') || 'no signals'}`,
        });
      }
    }
    if (deploys) {
      blocks.push({
        title: 'Deploys',
        body: deploys.summary + (deploys.entries[0]
          ? `\nLatest: ${deploys.entries[0].status} at ${deploys.entries[0].createdAt.slice(0, 19)}`
          : ''),
      });
    }
    if (metrics) {
      blocks.push({
        title: 'Metrics',
        body: metrics.signals.map(s => s.message).join('; ') || 'No notable signals',
      });
    }
    return blocks;
  }

  private buildActions(
    resourceId: string,
    resourceName: string,
    logs: LogSummary | null,
    deploys: DeployTimeline | null,
    metrics: MetricsSummary | null,
    snapshot: TopologySnapshot
  ): SuggestedAction[] {
    const actions: SuggestedAction[] = [];

    if (deploys?.entries.some(e => e.regressionCandidate)) {
      actions.push({
        tool: 'render_deploy',
        description: `Redeploy or roll back ${resourceName}`,
        args: { serviceId: resourceId },
      });
    }

    if (logs) {
      actions.push({
        tool: 'render_observe',
        description: 'Drill into raw logs for stack traces',
        args: { resourceId, mode: 'logs', raw: true, severity: 'error' },
      });
    }

    if (metrics?.signals.some(s => s.severity === 'critical' || s.severity === 'warning')) {
      actions.push({
        tool: 'render_observe',
        description: 'Full metrics drill-down',
        args: { resourceId, mode: 'metrics' },
      });
      if (getResourceType(resourceId) === 'service') {
        actions.push({
          tool: 'render_service',
          description: 'Consider plan scale-up if memory/CPU constrained',
          args: { serviceId: resourceId, action: 'configure' },
          requiresConfirmation: true,
        });
      }
    }

    const logText = logs?.patterns.map(p => p.sample).join(' ') ?? '';
    if (DB_ERROR_RE.test(logText)) {
      const pg = snapshot.databases[0];
      if (pg) {
        actions.push({
          tool: 'render_workspace',
          description: `Check Postgres status for ${pg.name}`,
          args: { resourceId: pg.id },
        });
      }
    }

    actions.push({
      tool: 'render_workspace',
      description: 'Full resource details',
      args: { resourceId },
    });

    return actions;
  }
}
