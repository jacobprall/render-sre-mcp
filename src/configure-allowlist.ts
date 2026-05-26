export type ConfigureTier = 1 | 2 | 'rejected';

export interface ConfigurePatch {
  plan?: string;
  autoDeploy?: 'yes' | 'no';
  healthCheckPath?: string;
  numInstances?: number;
}

export interface ClassifiedChange {
  field: keyof ConfigurePatch;
  tier: ConfigureTier;
  reason?: string;
}

const PLAN_ORDER = [
  'free', 'starter', 'standard', 'pro', 'pro_max', 'pro_plus', 'pro_ultra',
];

function planRank(plan: string): number {
  const i = PLAN_ORDER.indexOf(plan.toLowerCase());
  return i >= 0 ? i : PLAN_ORDER.length;
}

export function classifyConfigureChanges(
  patch: ConfigurePatch,
  currentPlan?: string
): ClassifiedChange[] {
  const results: ClassifiedChange[] = [];

  if (patch.plan !== undefined) {
    const cur = currentPlan ? planRank(currentPlan) : 0;
    const next = planRank(patch.plan);
    results.push({
      field: 'plan',
      tier: next >= cur ? 1 : 2,
      reason: next < cur ? 'Plan downgrade requires confirmed: true' : undefined,
    });
  }

  if (patch.autoDeploy !== undefined) {
    results.push({
      field: 'autoDeploy',
      tier: patch.autoDeploy === 'no' ? 1 : 2,
      reason: patch.autoDeploy === 'yes' ? 'Enabling auto-deploy requires confirmed: true' : undefined,
    });
  }

  if (patch.healthCheckPath !== undefined) {
    results.push({ field: 'healthCheckPath', tier: 1 });
  }

  if (patch.numInstances !== undefined) {
    const isScaleDown = patch.numInstances < 1;
    results.push({
      field: 'numInstances',
      tier: isScaleDown ? 2 : 1,
      reason: isScaleDown ? 'Scaling to zero instances requires confirmed: true' : undefined,
    });
  }

  return results;
}

export function getConfigureToolDescriptionExtra(): string {
  return `
Tier 1 (apply immediately): plan scale-up, autoDeploy off, healthCheckPath, scale instance count up.
Tier 2 (requires confirmed: true AND explicit user approval in chat first): plan downgrade, autoDeploy on, scale down.
Rejected: repo, branch, build/start commands — use git push or Dashboard.`;
}

export function validateConfigureRequest(
  patch: ConfigurePatch,
  confirmed: boolean,
  currentPlan?: string
): { ok: true; tier: ConfigureTier } | { ok: false; error: string } {
  const keys = Object.keys(patch) as (keyof ConfigurePatch)[];
  if (keys.length === 0) {
    return { ok: false, error: 'No configuration changes provided.' };
  }

  const classified = classifyConfigureChanges(patch, currentPlan);
  const maxTier = classified.reduce<ConfigureTier>((max, c) => {
    if (c.tier === 'rejected') return 'rejected';
    if (max === 'rejected') return 'rejected';
    if (c.tier === 2 || max === 2) return 2;
    return 1;
  }, 1);

  for (const c of classified) {
    if (c.tier === 'rejected') {
      return { ok: false, error: `Field ${c.field} cannot be changed via MCP. Use the Render Dashboard.` };
    }
  }

  if (maxTier === 2 && !confirmed) {
    return {
      ok: false,
      error: `Risky change requires confirmed: true. Obtain explicit user approval first. ${classified.filter(c => c.tier === 2).map(c => c.reason).join(' ')}`,
    };
  }

  return { ok: true, tier: maxTier === 2 ? 2 : 1 };
}
