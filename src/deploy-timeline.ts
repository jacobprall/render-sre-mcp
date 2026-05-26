import type { Deploy } from 'render-api';
import type { DeployTimeline, DeployTimelineEntry } from './types.js';

const REGRESSION_WINDOW_MS = 30 * 60 * 1000;

export class DeployTimelineBuilder {
  build(
    serviceId: string,
    serviceName: string,
    deploys: Deploy[],
    opts?: { errorCountInWindow?: number; windowStart?: Date }
  ): DeployTimeline {
    const entries = deploys.map(d => this.toEntry(d, deploys, opts));
    const regression = entries.find(e => e.regressionCandidate);
    const summary = regression
      ? `Latest regression candidate: deploy ${regression.id} (${regression.status})`
      : entries.length > 0
        ? `Last deploy: ${entries[0].status} at ${entries[0].createdAt.slice(0, 19)}`
        : 'No deploys yet';

    return { serviceId, serviceName, entries, summary };
  }

  format(timeline: DeployTimeline, maxLines = 25): string {
    const lines: string[] = [
      `## Deploy history: ${timeline.serviceName} (${timeline.serviceId})`,
      timeline.summary,
      '',
    ];

    if (timeline.entries.length === 0) {
      lines.push('No deploys found for this service.');
      return lines.join('\n');
    }

    lines.push('### Timeline (newest first)');
    for (const e of timeline.entries) {
      const flag = e.regressionCandidate ? ' **[regression?]**' : '';
      const commit = e.commitId ? ` · ${e.commitId}` : '';
      const msg = e.commitMessage ? ` — ${e.commitMessage.slice(0, 60)}` : '';
      const dur = e.durationMs != null ? ` · ${Math.round(e.durationMs / 1000)}s` : '';
      lines.push(
        `- ${e.createdAt.slice(0, 19)} │ ${e.status}${commit}${dur}${flag}`
      );
      if (e.id) lines.push(`  dep: ${e.id}`);
      if (lines.length >= maxLines) {
        lines.push(`… ${timeline.entries.length - timeline.entries.indexOf(e) - 1} more`);
        break;
      }
    }

    return lines.join('\n');
  }

  private toEntry(
    deploy: Deploy,
    allDeploys: Deploy[],
    opts?: { errorCountInWindow?: number; windowStart?: Date }
  ): DeployTimelineEntry {
    const createdAt = deploy.createdAt ?? '';
    const finishedAt = deploy.finishedAt ?? undefined;
    const start = new Date(createdAt).getTime();
    const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
    const durationMs = Number.isFinite(start) ? end - start : undefined;

    const commit = (deploy as { commit?: { id?: string; message?: string } }).commit;
    const commitId = commit?.id?.slice(0, 7);
    const commitMessage = commit?.message;

    const regressionCandidate = this.isRegressionCandidate(
      deploy,
      opts?.errorCountInWindow ?? 0,
      opts?.windowStart
    );

    return {
      id: deploy.id,
      status: deploy.status ?? 'unknown',
      createdAt,
      finishedAt,
      durationMs,
      commitId,
      commitMessage,
      regressionCandidate,
    };
  }

  private isRegressionCandidate(
    deploy: Deploy,
    errorCount: number,
    windowStart?: Date
  ): boolean {
    if (errorCount <= 0) return false;
    const status = (deploy.status ?? '').toLowerCase();
    if (status !== 'live' && status !== 'deactivated') return false;

    const liveAt = deploy.finishedAt ?? deploy.updatedAt ?? deploy.createdAt;
    if (!liveAt) return false;

    const liveMs = new Date(liveAt).getTime();
    if (!Number.isFinite(liveMs)) return false;

    const now = Date.now();
    if (now - liveMs > REGRESSION_WINDOW_MS) return false;

    if (windowStart) {
      const windowMs = windowStart.getTime();
      if (liveMs < windowMs) return false;
    }

    return true;
  }
}
