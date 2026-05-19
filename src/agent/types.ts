/**
 * Phase 3 L5: Agentic plan-then-act + data-egress classification.
 *
 * Mirrors the shapes returned by the LP control plane
 * `POST /v1/agent/plans` and `POST /v1/agent/plans/:id/steps/:idx/act`.
 *
 * License: BSL-1.1 (converts to Apache-2.0 after 4 years)
 */

export type AgentEgressCategory =
  | 'pii'
  | 'secret'
  | 'tool_arg_injection'
  | 'untrusted_url'
  | 'high_risk_recipient';

export type AgentEgressVerdict = 'ALLOW' | 'WARN' | 'BLOCK';

export interface AgentEgressFlag {
  category: AgentEgressCategory;
  field: string;
  evidence: string;
  score: number;
}

export interface AgentEgressClassification {
  verdict: AgentEgressVerdict;
  flags: AgentEgressFlag[];
  latencyMs: number;
}

export interface AgentPlanStepInput {
  tool: string;
  args: Record<string, unknown>;
}

export interface AgentPlanStep extends AgentPlanStepInput {
  argsDigest: string;
  egress: AgentEgressClassification;
}

export type AgentPlanStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EXECUTED';

export interface AgentPlan {
  id: string;
  status: AgentPlanStatus;
  goal: string;
  agentId: string;
  expiresAt: string;
  createdAt: string;
  approvedAt: string | null;
  rejectReason: string | null;
  metadata: Record<string, unknown> | null;
  steps: AgentPlanStep[];
}

export interface AgentPlanInput {
  agentId: string;
  goal: string;
  steps: AgentPlanStepInput[];
  metadata?: Record<string, unknown>;
  ttlSeconds?: number;
}

export interface AgentActResult {
  verdict: AgentEgressVerdict;
  flags: AgentEgressFlag[];
  argsMatch: boolean;
  latencyMs: number;
}

export class EgressViolationError extends Error {
  readonly verdict: AgentEgressVerdict;
  readonly flags: AgentEgressFlag[];

  constructor(message: string, verdict: AgentEgressVerdict, flags: AgentEgressFlag[]) {
    super(message);
    this.name = 'EgressViolationError';
    this.verdict = verdict;
    this.flags = flags;
  }
}

export class PlanNotApprovedError extends Error {
  constructor(public readonly status: AgentPlanStatus) {
    super(`Plan is ${status}; only APPROVED plans may be acted on`);
    this.name = 'PlanNotApprovedError';
  }
}
