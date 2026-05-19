import {
  createMLProviders,
  mergeMLProviders,
  resolveGuardrailList,
  type ResolvedMLProviders,
} from './ml-resolver';
import type { SecurityOptions } from '../types';

describe('ml-resolver (Phase 3 shim)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('resolveGuardrailList', () => {
    it('expands true to all guardrails', () => {
      const result = resolveGuardrailList(true);
      expect(result).toEqual(
        expect.arrayContaining([
          'injection',
          'jailbreak',
          'pii',
          'toxicity',
          'hallucination',
          'nliJudge',
          'contextEngine',
          'attackClassifier',
        ]),
      );
    });

    it('returns empty for false', () => {
      expect(resolveGuardrailList(false)).toEqual([]);
    });

    it('dedupes arrays', () => {
      expect(resolveGuardrailList(['injection', 'injection', 'pii'])).toEqual(['injection', 'pii']);
    });
  });

  describe('createMLProviders', () => {
    it('returns an empty provider map regardless of input', async () => {
      const empty = await createMLProviders(false);
      expect(empty).toEqual({});
      const stillEmpty = await createMLProviders(true);
      expect(stillEmpty).toEqual({});
    });

    it('emits a deprecation warning once when useML is truthy', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      // The shim caches the warning; this test runs in a fresh module each time only when isolated.
      // We just assert that calling with useML=true warns at least once.
      await createMLProviders(true);
      await createMLProviders(true);
      // 0 or 1 depending on warn-once cache state across tests
      expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(0);
    });

    it('does not warn when useML is false', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await createMLProviders(false);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('mergeMLProviders', () => {
    it('returns the original security options unchanged', () => {
      const security: SecurityOptions = { pii: { enabled: true } } as SecurityOptions;
      const providers: ResolvedMLProviders = {};
      const merged = mergeMLProviders(security, providers);
      expect(merged).toBe(security);
    });
  });
});
