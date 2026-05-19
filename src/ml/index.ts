/**
 * launchpromptly/ml — Phase 3 deprecation shim.
 *
 * The inline ML detectors have been removed from the SDK. ML detection now
 * runs in the LaunchPromptly Scanner sidecar (one fleet, shared across all
 * app pods, hot-reloadable models, GPU-aware). The SDK is a thin trust
 * boundary running only rule-based work locally.
 *
 * Migration:
 *
 *   // Before (SDK < 1.0):
 *   import { MLInjectionDetector } from 'launchpromptly/ml';
 *   const injection = await MLInjectionDetector.create();
 *
 *   // After (SDK ≥ 1.0):
 *   //   1. Deploy launchpromptly-scanner (Helm: `helm install launchpromptly/scanner`)
 *   //   2. Set LP_SCANNER_URL=http://launchpromptly-scanner.svc.cluster.local:7080
 *   //   3. The SDK ScannerClient discovers it automatically; ML detection is on by default.
 *
 * See: launchpromptly.dev/migration/inline-ml-removal
 *
 * License: BSL-1.1 (converts to Apache-2.0 after 4 years)
 *
 * @module
 */

const MIGRATION_URL = 'https://launchpromptly.dev/migration/inline-ml-removal';

function deprecated(name: string): never {
  throw new Error(
    `[launchpromptly] ${name} was removed in SDK 1.0. ` +
      `Inline ML detection has been consolidated into the launchpromptly-scanner sidecar. ` +
      `See ${MIGRATION_URL} for the migration guide. ` +
      `Quick fix: deploy the scanner Helm chart and set LP_SCANNER_URL — the SDK will discover it automatically.`,
  );
}

class RemovedDetector {
  static async create(): Promise<never> {
    return deprecated(this.name);
  }
  constructor() {
    deprecated(new.target?.name ?? 'launchpromptly/ml detector');
  }
}

export class MLToxicityDetector extends RemovedDetector {}
export class MLInjectionDetector extends RemovedDetector {}
export class MLPIIDetector extends RemovedDetector {}
export class MLJailbreakDetector extends RemovedDetector {}
export class MLHallucinationDetector extends RemovedDetector {}
export class MLEmbeddingProvider extends RemovedDetector {}
export class MLResponseJudge extends RemovedDetector {}
export class MLContextExtractor extends RemovedDetector {}
export class MLAttackClassifier extends RemovedDetector {}
export class OnnxSession extends RemovedDetector {}

export type MLToxicityDetectorOptions = Record<string, never>;
export type MLInjectionDetectorOptions = Record<string, never>;
export type MLPIIDetectorOptions = Record<string, never>;
export type MLJailbreakDetectorOptions = Record<string, never>;
export type MLHallucinationDetectorOptions = Record<string, never>;
export type MLEmbeddingProviderOptions = Record<string, never>;
export type MLResponseJudgeOptions = Record<string, never>;
export type MLContextExtractorOptions = Record<string, never>;
export type MLAttackClassifierOptions = Record<string, never>;
export type OnnxSessionOptions = Record<string, never>;
export type AttackClassification = { label: string; score: number };
export type AttackLabel = string;
export type AttackEmbeddingIndex = unknown;
export type AttackMatch = unknown;
export type AttackCategory = unknown;
export type EnsureModelOptions = Record<string, never>;

export function loadAttackIndex(): never {
  return deprecated('loadAttackIndex');
}
export function matchAgainstIndex(): never {
  return deprecated('matchAgainstIndex');
}
export function hasAttackMatch(): never {
  return deprecated('hasAttackMatch');
}

export function ensureModel(): never {
  return deprecated('ensureModel');
}
export function getCacheDir(): never {
  return deprecated('getCacheDir');
}
export function removeModel(): never {
  return deprecated('removeModel');
}
export function listCachedModels(): never {
  return deprecated('listCachedModels');
}
export function getRegisteredModels(): never {
  return deprecated('getRegisteredModels');
}

export const MODEL_NAME_MAP: Record<string, string> = {};
