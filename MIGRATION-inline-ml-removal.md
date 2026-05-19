# Migration guide — `launchpromptly` 1.0 (inline ML removal)

Phase 3 of the [enterprise-multimodal roadmap](https://launchpromptly.dev/roadmap) removes inline ML detection from the SDK.

## What changed

- All `launchpromptly/ml` detectors are now **shims that throw `Error`** with a pointer to this guide.
- `useML` on `SecurityOptions` is a **no-op**. The SDK prints a one-shot console warning on first truthy call.
- `onnxruntime-node` and `@huggingface/transformers` are no longer listed as peer or dev dependencies.
- `launchpromptly` CLI bin entry has been removed (`launchpromptly-mcp-scan` CLI is unaffected; it lives in its own package).
- Published package size drops from ~12 MB to ~290 KB (gzipped).

## Why

The SDK is a thin trust boundary that should run inside every app pod with sub-millisecond overhead. ML inference belongs in a shared, GPU-aware, hot-reloadable, holdout-eval-gated fleet (`launchpromptly-scanner`) — not duplicated inside thousands of customer app pods. See the [model lifecycle plane](https://launchpromptly.dev/docs/scanner/model-lifecycle) for the full design.

This deprecation was announced in SDK 0.5 (Phase 2: `p2_ml_default_sidecar`) with a 6-month removal notice. SDK 1.0 fulfils it.

## How to migrate

### 1. Deploy the scanner (if you have not already)

```bash
helm repo add launchpromptly https://charts.launchpromptly.dev
helm install launchpromptly-scanner launchpromptly/scanner \
  --namespace launchpromptly --create-namespace \
  --set mode=deployment   # or daemonset / sidecar
```

The scanner ships with the same models the inline detectors loaded — DeBERTa-v3 prompt-injection, Presidio NER, MiniLM NLI judge, MS-MARCO MiniLM, ToxicBERT, plus the multimodal detectors (OCR, NSFW, deepfake, Whisper).

### 2. Tell the SDK where to find it

Either set `LP_SCANNER_URL` as an env var:

```bash
export LP_SCANNER_URL=http://launchpromptly-scanner.launchpromptly.svc.cluster.local:7080
```

…or pass it explicitly when constructing the LP client. The SDK auto-discovers the scanner in this order: explicit URL → in-cluster K8s service DNS → control-plane-injected config → fall back to `regex_only` mode.

### 3. Remove inline-ML code from your application

```diff
- import { MLInjectionDetector, MLToxicityDetector } from 'launchpromptly/ml';
- const lp = LaunchPromptly.init({ apiKey });
- const injection = await MLInjectionDetector.create();
- const toxicity = await MLToxicityDetector.create();
- const wrapped = lp.wrap(openai, {
-   security: {
-     useML: true,
-     injection: { providers: [injection] },
-     contentFilter: { providers: [toxicity] },
-   },
- });

+ import { LaunchPromptly } from 'launchpromptly';
+ const lp = LaunchPromptly.init({ apiKey });
+ const wrapped = lp.wrap(openai, {
+   security: {
+     // The SDK's ScannerClient calls the scanner automatically; no inline
+     // ML setup required. Adjust thresholds via your active LP policy in the
+     // control plane.
+   },
+ });
```

### 4. Uninstall the old peer deps (optional)

```bash
npm uninstall onnxruntime-node @huggingface/transformers
```

## What if I cannot run a scanner?

For air-gapped or constrained environments, the SDK falls back to its built-in rule-based detectors (regex, MIME sniff, hash, EXIF strip, PDF text, Unicode sweep, cost guard, schema validator, tool-arg checks). Detection quality drops on the semantic-injection / multilingual-jailbreak surfaces but the rule layer alone defends against the most common attacks.

Set `LP_SCANNER_FALLBACK=regex_only` (or in your policy DSL: `scanner.mlFallback: 'regex_only'`) to make this fallback explicit.

## What if I depended on the `OnnxSession` low-level helper or `attack-embeddings` utilities?

Those internal helpers were never part of the documented public API. They are removed. Open an issue at <https://github.com/rahuliiitm/launchpromptly-node-sdk/issues> if you used them so we can suggest a supported alternative.

## Rollback

If you cannot migrate immediately, pin the previous release:

```bash
npm install launchpromptly@0.6.1
```

The 0.6.x line will receive security patches for the remainder of the 6-month deprecation window (until end of Phase 3) and then enter end-of-life.
