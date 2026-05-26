import { runWithConcurrency } from '../../lib/concurrency.js';
import { formatAge } from '../../lib/time.js';
import * as api from '../../render-api.js';
import type { HotResourceTracker } from '../../hot-resources.js';
import { computeHotServiceIds } from '../../hot-resources.js';
import type { DeployHint, TopologySnapshot } from '../../types/topology.js';

const MAX_CONCURRENCY = 3;
const MAX_DEPLOY_HINTS = 5;

/** Latest deploy status for a small set of hot services (acted-on or suspended). */
export async function enrichDeployHints(
  snapshot: TopologySnapshot,
  hotTracker: HotResourceTracker
): Promise<Map<string, DeployHint>> {
  const deployHints = new Map<string, DeployHint>();
  const hot = computeHotServiceIds(snapshot, hotTracker);
  const candidates = [...snapshot.services]
    .filter(s => hot.has(s.id))
    .sort((a, b) => {
      const aActed = hotTracker.isActedOn(a.id) ? 0 : 1;
      const bActed = hotTracker.isActedOn(b.id) ? 0 : 1;
      if (aActed !== bActed) return aActed - bActed;
      const aSusp = a.suspended === 'suspended' ? 0 : 1;
      const bSusp = b.suspended === 'suspended' ? 0 : 1;
      return aSusp - bSusp;
    })
    .slice(0, MAX_DEPLOY_HINTS);

  const tasks = candidates.map(svc => async () => {
    try {
      const deploys = await api.fetchDeploys(svc.id, 1);
      const d = deploys[0];
      if (!d) return;
      const liveAt = d.finishedAt ?? d.updatedAt ?? d.createdAt ?? '';
      deployHints.set(svc.id, {
        ageLabel: liveAt ? formatAge(liveAt) : '?',
        status: d.status ?? 'unknown',
        deployId: d.id,
      });
    } catch { /* omit hint */ }
  });

  await runWithConcurrency(tasks, MAX_CONCURRENCY);
  return deployHints;
}
