/**
 * Phase 3: ml-resolver stub.
 *
 * Inline ML provider creation was removed in SDK 1.0. The resolver remains
 * only as a typed no-op so existing callers compile; at runtime it prints a
 * one-shot deprecation notice and returns an empty provider map. ML
 * detection is delivered via the launchpromptly-scanner sidecar.
 *
 * License: BSL-1.1 (converts to Apache-2.0 after 4 years)
 *
 * @internal
 */

import type { SecurityOptions, MLGuardrailType } from '../types';

export interface ResolvedMLProviders {
  injection?: never;
  jailbreak?: never;
  pii?: never;
  toxicity?: never;
  hallucination?: never;
  nliJudge?: never;
  contextEngine?: never;
  attackClassifier?: never;
}

const ALL_ML_GUARDRAILS: MLGuardrailType[] = [
  'injection',
  'jailbreak',
  'pii',
  'toxicity',
  'hallucination',
  'nliJudge',
  'contextEngine',
  'attackClassifier',
];

export function resolveGuardrailList(useML: boolean | MLGuardrailType[]): MLGuardrailType[] {
  if (useML === true) return [...ALL_ML_GUARDRAILS];
  if (useML === false || !useML) return [];
  return [...new Set(useML)];
}

let warned = false;
function warnOnce(): void {
  if (warned) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn(
    '[launchpromptly] `useML` is a no-op in SDK 1.0 — inline ML was removed in Phase 3. ' +
      'Deploy launchpromptly-scanner and set LP_SCANNER_URL to enable ML detection. ' +
      'Migration guide: https://launchpromptly.dev/migration/inline-ml-removal',
  );
}

export async function createMLProviders(
  useML: boolean | MLGuardrailType[],
): Promise<ResolvedMLProviders> {
  if (resolveGuardrailList(useML).length > 0) warnOnce();
  return {};
}

export function mergeMLProviders(
  security: SecurityOptions,
  _mlProviders: ResolvedMLProviders,
): SecurityOptions {
  return security;
}
