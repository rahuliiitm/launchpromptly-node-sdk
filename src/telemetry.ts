/**
 * OpenTelemetry integration for LaunchPromptly Node.js SDK.
 *
 * Emits one span per guardrail decision with standard LP semantic attributes:
 *   lp.guardrail.layer        — L1/L2/L3/L4/L5
 *   lp.detection.type         — injection/pii/toxicity/response_judge/…
 *   lp.action                 — block/warn/allow
 *   lp.policy.version         — policy ID (from control plane pushdown)
 *   lp.risk.score             — 0.0–1.0 float
 *   lp.scanner.cache_hit      — boolean
 *
 * The SDK is OTEL-agnostic: if the caller has already configured an OTLP
 * exporter, LP spans will appear automatically. If not, no-op tracer is used.
 *
 * License: BSL-1.1 (converts to Apache-2.0 after 4 years)
 */

import type { Span, Tracer, SpanStatusCode } from '@opentelemetry/api';

// Lazy import — only pulled if @opentelemetry/api is installed
let _otelApi: typeof import('@opentelemetry/api') | null = null;

async function getOtelApi() {
  if (_otelApi) return _otelApi;
  try {
    _otelApi = await import('@opentelemetry/api');
  } catch {
    // @opentelemetry/api not installed — use no-ops
    _otelApi = null;
  }
  return _otelApi;
}

const TRACER_NAME = 'launchpromptly';
const TRACER_VERSION = '1.0.0';

export type GuardrailLayer = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export type DetectionType = 'injection' | 'pii' | 'toxicity' | 'jailbreak' | 'response_judge' | 'tool_guard' | 'context' | 'agentic';
export type GuardrailAction = 'block' | 'warn' | 'allow';

export interface GuardrailSpanAttrs {
  layer: GuardrailLayer;
  detectionType: DetectionType;
  action: GuardrailAction;
  policyVersion?: string;
  riskScore?: number;
  cacheHit?: boolean;
  projectId?: string;
  latencyMs?: number;
  /** Any extra K/V to attach as span attributes */
  extra?: Record<string, string | number | boolean>;
}

/**
 * Wrap a guardrail decision in an OTEL span.
 * If OTEL is not available or the exporter is not configured, behaves as a no-op.
 */
export async function withGuardrailSpan<T>(
  attrs: GuardrailSpanAttrs,
  fn: (span: Span | null) => Promise<T>,
): Promise<T> {
  const otel = await getOtelApi();
  if (!otel) {
    return fn(null);
  }

  const tracer = otel.trace.getTracer(TRACER_NAME, TRACER_VERSION);
  return tracer.startActiveSpan(
    `lp.guardrail.${attrs.detectionType}`,
    async (span) => {
      span.setAttributes({
        'lp.guardrail.layer': attrs.layer,
        'lp.detection.type': attrs.detectionType,
        'lp.action': attrs.action,
        ...(attrs.policyVersion ? { 'lp.policy.version': attrs.policyVersion } : {}),
        ...(attrs.riskScore !== undefined ? { 'lp.risk.score': attrs.riskScore } : {}),
        ...(attrs.cacheHit !== undefined ? { 'lp.scanner.cache_hit': attrs.cacheHit } : {}),
        ...(attrs.projectId ? { 'lp.project.id': attrs.projectId } : {}),
        ...(attrs.latencyMs !== undefined ? { 'lp.latency_ms': attrs.latencyMs } : {}),
        ...(attrs.extra ?? {}),
      });

      try {
        const result = await fn(span);
        span.setStatus({ code: 1 /* OK */ });
        return result;
      } catch (err: unknown) {
        span.setStatus({ code: 2 /* ERROR */, message: String(err) });
        span.recordException(err as Error);
        throw err;
      } finally {
        if (attrs.latencyMs !== undefined) {
          span.setAttribute('lp.latency_ms', attrs.latencyMs);
        }
        span.end();
      }
    },
  );
}

/**
 * Quick helper for synchronous guardrail decisions that don't need a span wrapper.
 * Records a point event on the current active span (if any) rather than creating a child span.
 */
export async function recordGuardrailEvent(attrs: GuardrailSpanAttrs): Promise<void> {
  const otel = await getOtelApi();
  if (!otel) return;

  const span = otel.trace.getActiveSpan();
  if (!span) return;

  span.addEvent('lp.guardrail', {
    'lp.guardrail.layer': attrs.layer,
    'lp.detection.type': attrs.detectionType,
    'lp.action': attrs.action,
    ...(attrs.riskScore !== undefined ? { 'lp.risk.score': attrs.riskScore } : {}),
    ...(attrs.cacheHit !== undefined ? { 'lp.scanner.cache_hit': attrs.cacheHit } : {}),
  });
}
