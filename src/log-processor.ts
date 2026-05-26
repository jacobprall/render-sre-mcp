import type { LogEntry } from './render-api.js';
import type { LogPattern, LogSummary, RequestSummary } from './types.js';

function getLabel(entry: LogEntry, name: string): string | undefined {
  return entry.labels.find(l => l.name === name)?.value;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_TS_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?/g;
const NUMBER_RE = /\b\d{4,}\b/g;
const HEX_RE = /\b0x[0-9a-f]{6,}\b/gi;
const IP_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g;
const PATH_SEGMENT_RE = /\/[0-9a-f]{8,}/gi;

const HTTP_LOG_RE =
  /(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+(\d{3})(?:\s+(\d+(?:\.\d+)?)\s*ms)?/g;

const ERROR_KEYWORDS = /\b(error|err|fatal|panic|exception|fail|crash|killed|oom|segfault|ECONNREFUSED|ENOTFOUND|ETIMEDOUT)\b/i;
const WARNING_KEYWORDS = /\b(warn|warning|deprecated|slow|timeout|retry)\b/i;

export class LogProcessor {
  normalize(line: string): string {
    return line
      .replace(ISO_TS_RE, '*')
      .replace(UUID_RE, '*')
      .replace(HEX_RE, '*')
      .replace(IP_RE, '*')
      .replace(PATH_SEGMENT_RE, '/*')
      .replace(NUMBER_RE, '*');
  }

  detectSeverity(line: string): 'error' | 'warning' | 'info' {
    if (ERROR_KEYWORDS.test(line)) return 'error';
    if (WARNING_KEYWORDS.test(line)) return 'warning';
    return 'info';
  }

  group(entries: LogEntry[]): LogPattern[] {
    const now = Date.now();
    const groups = new Map<string, {
      template: string;
      severity: 'error' | 'warning' | 'info';
      count: number;
      firstSeen: Date;
      lastSeen: Date;
      sample: string;
      timestamps: number[];
    }>();

    for (const entry of entries) {
      const normalized = this.normalize(entry.message);
      const level = getLabel(entry, 'level');
      const severity = level === 'error' ? 'error'
        : level === 'warn' || level === 'warning' ? 'warning'
        : this.detectSeverity(entry.message);

      const existing = groups.get(normalized);
      const ts = new Date(entry.timestamp);

      if (existing) {
        existing.count++;
        if (ts < existing.firstSeen) existing.firstSeen = ts;
        if (ts > existing.lastSeen) {
          existing.lastSeen = ts;
          existing.sample = entry.message;
        }
        existing.timestamps.push(ts.getTime());
        if (severity === 'error') existing.severity = 'error';
        else if (severity === 'warning' && existing.severity === 'info') existing.severity = 'warning';
      } else {
        groups.set(normalized, {
          template: normalized,
          severity,
          count: 1,
          firstSeen: ts,
          lastSeen: ts,
          sample: entry.message,
          timestamps: [ts.getTime()],
        });
      }
    }

    return Array.from(groups.values())
      .map(g => ({
        template: g.template,
        severity: g.severity,
        count: g.count,
        firstSeen: g.firstSeen,
        lastSeen: g.lastSeen,
        stillActive: now - g.lastSeen.getTime() < 60_000,
        sample: g.sample,
        correlatedWith: [],
      }))
      .sort((a, b) => {
        const sevOrder = { error: 0, warning: 1, info: 2 };
        if (sevOrder[a.severity] !== sevOrder[b.severity]) {
          return sevOrder[a.severity] - sevOrder[b.severity];
        }
        return b.count - a.count;
      });
  }

  correlate(patterns: LogPattern[]): void {
    const WINDOW_MS = 30_000;
    const MAX_CORRELATE = 50;
    const subset = patterns.slice(0, MAX_CORRELATE);

    for (let i = 0; i < subset.length; i++) {
      for (let j = i + 1; j < subset.length; j++) {
        const a = subset[i];
        const b = subset[j];
        const timeDiff = Math.abs(a.firstSeen.getTime() - b.firstSeen.getTime());
        if (timeDiff <= WINDOW_MS) {
          if (!a.correlatedWith.includes(b.template)) a.correlatedWith.push(b.template);
          if (!b.correlatedWith.includes(a.template)) b.correlatedWith.push(a.template);
        }
      }
    }
  }

  summarizeRequests(entries: LogEntry[]): RequestSummary | null {
    const pathStats = new Map<string, { count: number; totalMs: number; errors: number }>();
    const byStatus: Record<string, number> = {};
    let total = 0;

    for (const entry of entries) {
      HTTP_LOG_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = HTTP_LOG_RE.exec(entry.message)) !== null) {
        const [, path, statusStr, msStr] = match;
        const statusGroup = statusStr[0] + 'xx';
        const ms = msStr ? parseFloat(msStr) : 0;

        total++;
        byStatus[statusGroup] = (byStatus[statusGroup] ?? 0) + 1;

        const existing = pathStats.get(path) ?? { count: 0, totalMs: 0, errors: 0 };
        existing.count++;
        existing.totalMs += ms;
        if (statusStr.startsWith('4') || statusStr.startsWith('5')) existing.errors++;
        pathStats.set(path, existing);
      }
    }

    if (total === 0) return null;

    const topErrors = Array.from(pathStats.entries())
      .filter(([, s]) => s.errors > 0)
      .map(([path, s]) => ({ path, count: s.errors, avgMs: Math.round(s.totalMs / s.count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const slowRequests = Array.from(pathStats.entries())
      .map(([path, s]) => ({ path, count: s.count, avgMs: Math.round(s.totalMs / s.count) }))
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, 5);

    return { total, byStatus, topErrors, slowRequests };
  }

  detectSignals(patterns: LogPattern[], _requestSummary: RequestSummary | null): string[] {
    const signals: string[] = [];

    const errors = patterns.filter(p => p.severity === 'error');
    const totalErrors = errors.reduce((sum, p) => sum + p.count, 0);
    if (totalErrors > 10) {
      signals.push(`Error spike: ${totalErrors} errors in the time window`);
    }

    for (const p of errors) {
      if (p.stillActive) {
        signals.push(`Active error: "${p.template.slice(0, 60)}..." is still occurring`);
      }
    }

    const depFailures = errors.filter(p =>
      /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connection refused|connect timeout/i.test(p.sample)
    );
    for (const d of depFailures) {
      signals.push(`Dependency failure: ${d.sample.slice(0, 80)}`);
    }

    return signals;
  }

  formatSummary(summary: LogSummary): string {
    const lines: string[] = [];
    const startStr = summary.window.start.toISOString().slice(11, 19);
    const endStr = summary.window.end.toISOString().slice(11, 19);
    lines.push(`## Logs: ${summary.resourceName} (${summary.resourceId}) — ${startStr} to ${endStr}`);

    const errors = summary.patterns.filter(p => p.severity === 'error');
    const warnings = summary.patterns.filter(p => p.severity === 'warning');

    if (errors.length > 0) {
      lines.push('');
      lines.push('### Error Patterns');
      for (const p of errors.slice(0, 10)) {
        const active = p.stillActive ? ' | still active' : '';
        lines.push(
          `${p.count}× "${p.template.slice(0, 80)}" | first: ${p.firstSeen.toISOString().slice(11, 19)} | last: ${p.lastSeen.toISOString().slice(11, 19)}${active}`
        );
        lines.push(`   Sample: ${p.sample.slice(0, 120)}`);
      }
    }

    if (warnings.length > 0) {
      lines.push('');
      lines.push('### Warnings');
      for (const p of warnings.slice(0, 5)) {
        lines.push(`${p.count}× "${p.template.slice(0, 80)}"`);
      }
    }

    const correlated = summary.patterns.filter(p => p.correlatedWith.length > 0);
    if (correlated.length > 0) {
      lines.push('');
      lines.push('### Correlations');
      const seen = new Set<string>();
      for (const p of correlated) {
        for (const other of p.correlatedWith) {
          const key = [p.template, other].sort().join('|||');
          if (!seen.has(key)) {
            seen.add(key);
            lines.push(`- "${p.template.slice(0, 50)}" co-occurs with "${other.slice(0, 50)}" (same 30s window)`);
          }
        }
      }
    }

    if (summary.requestSummary) {
      const rs = summary.requestSummary;
      lines.push('');
      lines.push('### Request Summary');
      lines.push(`Total: ${rs.total} | ${Object.entries(rs.byStatus).map(([k, v]) => `${k}: ${v}`).join(' | ')}`);
      if (rs.topErrors.length > 0) {
        lines.push('Top errors: ' + rs.topErrors.map(e => `${e.path} (${e.count}×, ${e.avgMs}ms avg)`).join(', '));
      }
      if (rs.slowRequests.length > 0) {
        lines.push('Slowest: ' + rs.slowRequests.map(s => `${s.path} (${s.avgMs}ms avg)`).join(', '));
      }
    }

    if (summary.signals.length > 0) {
      lines.push('');
      lines.push('### Signals');
      for (const s of summary.signals) {
        lines.push(`- ${s}`);
      }
    }

    if (errors.length === 0 && warnings.length === 0) {
      lines.push('');
      lines.push('No errors or warnings found in this time window.');
    }

    return lines.join('\n');
  }

  process(
    entries: LogEntry[],
    resourceId: string,
    resourceName: string,
    window: { start: Date; end: Date }
  ): LogSummary {
    const patterns = this.group(entries);
    this.correlate(patterns);
    const requestSummary = this.summarizeRequests(entries);
    const signals = this.detectSignals(patterns, requestSummary);
    return { resourceId, resourceName, window, patterns, requestSummary, signals };
  }
}
