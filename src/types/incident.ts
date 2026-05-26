export interface SuggestedAction {
  tool: string;
  description: string;
  args?: Record<string, unknown>;
  requiresConfirmation?: boolean;
}

export interface EvidenceBlock {
  title: string;
  body: string;
}

export interface IncidentBrief {
  resourceId: string;
  resourceName: string;
  window: { start: Date; end: Date };
  hypothesis: string;
  confidence: 'low' | 'medium' | 'high';
  evidence: EvidenceBlock[];
  suggestedActions: SuggestedAction[];
  risks: string[];
}
