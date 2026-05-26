import * as api from '../render-api.js';
import {
  getConfigureToolDescriptionExtra,
  validateConfigureRequest,
  type ConfigurePatch,
} from '../configure-allowlist.js';
import type { TopologySnapshot, ToolCallResult } from '../types.js';
import { getResourceName } from '../types.js';

export async function handleConfigure(
  args: {
    serviceId: string;
    confirmed?: boolean;
    plan?: string;
    autoDeploy?: 'yes' | 'no';
    healthCheckPath?: string;
    numInstances?: number;
  },
  snapshot: TopologySnapshot
): Promise<ToolCallResult> {
  const name = getResourceName(snapshot, args.serviceId) ?? args.serviceId;
  const patch: ConfigurePatch = {};
  if (args.plan !== undefined) patch.plan = args.plan;
  if (args.autoDeploy !== undefined) patch.autoDeploy = args.autoDeploy;
  if (args.healthCheckPath !== undefined) patch.healthCheckPath = args.healthCheckPath;
  if (args.numInstances !== undefined) patch.numInstances = args.numInstances;

  const service = snapshot.services.find(s => s.id === args.serviceId);
  const currentPlan = (service?.serviceDetails as { plan?: string } | undefined)?.plan;

  const validation = validateConfigureRequest(patch, args.confirmed ?? false, currentPlan);
  if (!validation.ok) {
    return {
      content: [{ type: 'text', text: validation.error }],
      isError: true,
    };
  }

  const body: Record<string, unknown> = {};
  if (patch.plan) {
    body.serviceDetails = { ...(body.serviceDetails as object), plan: patch.plan };
  }
  if (patch.autoDeploy) {
    body.autoDeploy = patch.autoDeploy;
  }
  if (patch.healthCheckPath) {
    body.serviceDetails = {
      ...(body.serviceDetails as object),
      healthCheckPath: patch.healthCheckPath,
    };
  }
  if (patch.numInstances != null) {
    body.serviceDetails = {
      ...(body.serviceDetails as object),
      numInstances: patch.numInstances,
    };
  }

  const updated = await api.patchService(args.serviceId, body);

  return {
    content: [{
      type: 'text',
      text: [
        `Configuration updated for ${name} (${args.serviceId})`,
        `Tier: ${validation.tier}`,
        `Plan: ${(updated.serviceDetails as { plan?: string })?.plan ?? 'unchanged'}`,
        'A redeploy or restart may be required for some changes to take effect.',
        getConfigureToolDescriptionExtra(),
      ].join('\n'),
    }],
  };
}
