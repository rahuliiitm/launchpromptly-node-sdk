import { AgentClient } from './client';
import { EgressViolationError, PlanNotApprovedError } from './types';

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
});

function mockFetch(impl: (input: string, init?: RequestInit) => Promise<Response>) {
  global.fetch = jest.fn(impl as unknown as typeof fetch) as unknown as typeof fetch;
}

const samplePlan = {
  id: 'plan-1',
  status: 'PENDING' as const,
  goal: 'test',
  agentId: 'a',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
  approvedAt: null,
  rejectReason: null,
  metadata: null,
  steps: [
    {
      tool: 'crm.lookup',
      args: { q: 'hi' },
      argsDigest: 'd',
      egress: { verdict: 'ALLOW' as const, flags: [], latencyMs: 1 },
    },
  ],
};

describe('AgentClient', () => {
  it('POSTs a plan and returns it', async () => {
    mockFetch(async (url) => {
      expect(url).toContain('/v1/agent/plans');
      return new Response(JSON.stringify(samplePlan), { status: 200 });
    });
    const client = new AgentClient({ apiUrl: 'http://lp', apiKey: 'lp_live_test' });
    const plan = await client.plan({ agentId: 'a', goal: 't', steps: [{ tool: 'x', args: {} }] });
    expect(plan.id).toBe('plan-1');
  });

  it('throws EgressViolationError on BLOCK verdict', async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          verdict: 'BLOCK',
          flags: [{ category: 'secret', field: 'args.body', evidence: 'sk-...', score: 1 }],
          argsMatch: true,
          latencyMs: 2,
        }),
        { status: 200 },
      ),
    );
    const client = new AgentClient({ apiUrl: 'http://lp', apiKey: 'lp_live_test' });
    await expect(client.act('plan-1', 0, {})).rejects.toBeInstanceOf(EgressViolationError);
  });

  it('throws on WARN when strict=true', async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({ verdict: 'WARN', flags: [], argsMatch: true, latencyMs: 0 }),
        { status: 200 },
      ),
    );
    const client = new AgentClient({ apiUrl: 'http://lp', apiKey: 'lp_live_test', strict: true });
    await expect(client.act('plan-1', 0, {})).rejects.toBeInstanceOf(EgressViolationError);
  });

  it('returns successfully on ALLOW', async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({ verdict: 'ALLOW', flags: [], argsMatch: true, latencyMs: 0 }),
        { status: 200 },
      ),
    );
    const client = new AgentClient({ apiUrl: 'http://lp', apiKey: 'lp_live_test' });
    const r = await client.act('plan-1', 0, {});
    expect(r.verdict).toBe('ALLOW');
  });

  it('surfaces non-200 errors with body text', async () => {
    mockFetch(async () => new Response('forbidden', { status: 403 }));
    const client = new AgentClient({ apiUrl: 'http://lp', apiKey: 'lp_live_test' });
    await expect(client.plan({ agentId: 'a', goal: 't', steps: [{ tool: 'x', args: {} }] }))
      .rejects.toThrow(/403/);
  });

  it('planAndExecute throws PlanNotApprovedError if plan stays PENDING past maxWaitMs', async () => {
    mockFetch(async () => new Response(JSON.stringify(samplePlan), { status: 200 }));
    const client = new AgentClient({ apiUrl: 'http://lp', apiKey: 'lp_live_test' });
    await expect(
      client.planAndExecute(
        { agentId: 'a', goal: 't', steps: [{ tool: 'x', args: {} }] },
        async () => 'ok',
        { pollMs: 10, maxWaitMs: 50 },
      ),
    ).rejects.toBeInstanceOf(PlanNotApprovedError);
  });
});
