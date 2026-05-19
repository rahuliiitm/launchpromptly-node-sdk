/**
 * Phase 3 L5: SDK helpers for `lp.agent.plan()` and `lp.agent.act()`.
 *
 * Thin client over the LP control plane REST API. Uses the same API key the
 * SDK was constructed with. No autonomous behaviour — the customer's existing
 * tool runner still executes the call; this helper just gates each call
 * through the LP egress classifier.
 *
 * License: BSL-1.1 (converts to Apache-2.0 after 4 years)
 */

import {
  EgressViolationError,
  PlanNotApprovedError,
  type AgentActResult,
  type AgentPlan,
  type AgentPlanInput,
} from './types';

export interface AgentClientOptions {
  /** Base URL of the LP control plane. Default reads LP_API_URL or https://api.launchpromptly.dev */
  apiUrl?: string;
  /** API key (lp_live_...). Falls back to LP_API_KEY env. */
  apiKey?: string;
  /** Per-call timeout (ms). Default 10_000. */
  timeoutMs?: number;
  /** Throw on WARN as well as BLOCK. Default false (WARN is audited but allowed). */
  strict?: boolean;
}

const DEFAULT_API = 'https://api.launchpromptly.dev';

function envOrThrow(key: string, opt?: string): string {
  const v = opt ?? process.env[key];
  if (!v) throw new Error(`${key} is required (pass via options or env)`);
  return v;
}

export class AgentClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly strict: boolean;

  constructor(opts: AgentClientOptions = {}) {
    this.apiUrl = (opts.apiUrl ?? process.env['LP_API_URL'] ?? DEFAULT_API).replace(/\/$/, '');
    this.apiKey = envOrThrow('LP_API_KEY', opts.apiKey);
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.strict = opts.strict ?? false;
  }

  /** Submit a plan to the control plane for egress classification + (optional) operator approval. */
  async plan(input: AgentPlanInput): Promise<AgentPlan> {
    return this.request<AgentPlan>('POST', '/v1/agent/plans', input);
  }

  /** Fetch the current state of a plan (status may have moved to APPROVED / REJECTED / EXPIRED). */
  async getPlan(planId: string): Promise<AgentPlan> {
    return this.request<AgentPlan>('GET', `/v1/agent/plans/${encodeURIComponent(planId)}`);
  }

  /**
   * Re-classify a single step's actual arguments before the customer's tool runner
   * executes it. Throws {@link EgressViolationError} on BLOCK (and on WARN if strict).
   */
  async act(
    planId: string,
    stepIndex: number,
    actualArgs: Record<string, unknown>,
  ): Promise<AgentActResult> {
    const result = await this.request<AgentActResult>(
      'POST',
      `/v1/agent/plans/${encodeURIComponent(planId)}/steps/${stepIndex}/act`,
      { actualArgs },
    );

    if (result.verdict === 'BLOCK' || (this.strict && result.verdict === 'WARN')) {
      throw new EgressViolationError(
        `LP egress classifier returned ${result.verdict} for step ${stepIndex}`,
        result.verdict,
        result.flags,
      );
    }
    return result;
  }

  /** Convenience: plan + wait for approval (polling) + act on every step in order. */
  async planAndExecute(
    input: AgentPlanInput,
    executor: (step: AgentPlan['steps'][number]) => Promise<unknown>,
    options: { pollMs?: number; maxWaitMs?: number } = {},
  ): Promise<{ plan: AgentPlan; results: unknown[] }> {
    const pollMs = options.pollMs ?? 2_000;
    const maxWaitMs = options.maxWaitMs ?? 60_000;
    let plan = await this.plan(input);

    const deadline = Date.now() + maxWaitMs;
    while (plan.status === 'PENDING' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      plan = await this.getPlan(plan.id);
    }
    if (plan.status !== 'APPROVED') {
      throw new PlanNotApprovedError(plan.status);
    }

    const results: unknown[] = [];
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]!;
      await this.act(plan.id, i, step.args);
      results.push(await executor(step));
    }
    return { plan, results };
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.apiUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`LP agent API ${res.status}: ${text || res.statusText}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
