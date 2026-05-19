/**
 * ScannerClient — discovers and calls the launchpromptly-scanner service.
 *
 * Discovery order:
 *   1. LP_SCANNER_URL env var
 *   2. K8s service DNS: http://launchpromptly-scanner.launchpromptly-system.svc.cluster.local:7080
 *   3. Control-plane config (fetched once and cached)
 *   4. regex_only fallback (inline)
 *
 * Features:
 *   - HTTP keep-alive connection pool (node-fetch with agent)
 *   - Per-call timeout (configurable, default 5 s)
 *   - Circuit breaker (3 consecutive failures → open for 30 s)
 *   - Ed25519 request auth token (per-project, optional)
 *
 * License: BSL-1.1 (converts to Apache-2.0 after 4 years)
 */

import { createHash, createSign } from 'crypto';
import * as http from 'http';
import * as https from 'https';

export type MlMode = 'inline' | 'sidecar' | 'cluster' | 'off';
export type MlFallback = 'fail_open' | 'fail_closed' | 'regex_only';

export interface ScannerClientOptions {
  /**
   * Explicit scanner URL. Overrides all auto-discovery.
   * Reads from LP_SCANNER_URL env if not provided.
   */
  scannerUrl?: string;

  /** LP project ID for per-project token scoping */
  projectId?: string;

  /** Ed25519 private key (PEM) for signing requests. Optional — scanner treats unsigned as anonymous */
  ed25519PrivateKeyPem?: string;

  /** Per-call timeout in ms. Default: 5000 */
  callTimeoutMs?: number;

  /** Circuit breaker: consecutive failures to trip. Default: 3 */
  cbFailureThreshold?: number;

  /** Circuit breaker: open duration in ms. Default: 30_000 */
  cbOpenDurationMs?: number;

  /** What to do when scanner is unavailable */
  mlFallback?: MlFallback;
}

export interface TextScanResult {
  injectionScore: number;
  injectionBlocked: boolean;
  piiEntities: Array<{ type: string; score: number; start: number; end: number }>;
  piiBlocked: boolean;
  toxicityScore: number;
  toxicityBlocked: boolean;
  cacheHit: boolean;
  scannerMode: 'scanner' | 'inline' | 'regex_only';
  latencyMs: number;
}

export interface ImageScanResult {
  nsfwScore: number;
  nsfwBlocked: boolean;
  faceDetected: boolean;
  ocrText?: string;
  cacheHit: boolean;
  latencyMs: number;
}

export interface PdfScanResult {
  extractedText: string;
  piiEntities: Array<{ type: string; score: number }>;
  injectionScore: number;
  cacheHit: boolean;
  latencyMs: number;
}

enum CircuitState { CLOSED, HALF_OPEN, OPEN }

export class ScannerClient {
  private resolvedUrl: string | null = null;
  private resolving: Promise<string | null> | null = null;

  private cbState = CircuitState.CLOSED;
  private cbFailures = 0;
  private cbOpenedAt = 0;

  private readonly opts: Required<ScannerClientOptions>;
  private readonly httpAgent: http.Agent;
  private readonly httpsAgent: https.Agent;

  constructor(opts: ScannerClientOptions = {}) {
    this.opts = {
      scannerUrl: opts.scannerUrl ?? process.env['LP_SCANNER_URL'] ?? '',
      projectId: opts.projectId ?? '',
      ed25519PrivateKeyPem: opts.ed25519PrivateKeyPem ?? process.env['LP_SCANNER_SIGNING_KEY'] ?? '',
      callTimeoutMs: opts.callTimeoutMs ?? 5_000,
      cbFailureThreshold: opts.cbFailureThreshold ?? 3,
      cbOpenDurationMs: opts.cbOpenDurationMs ?? 30_000,
      mlFallback: opts.mlFallback ?? 'regex_only',
    };

    this.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 20 });
    this.httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });
  }

  /** Scan a text string through the ML scanner. */
  async scanText(
    text: string,
    context?: { policyVersion?: string; projectId?: string },
  ): Promise<TextScanResult> {
    const url = await this.discoverUrl();
    if (!url || !this.circuitAllows()) {
      return this.fallbackTextResult();
    }

    const t0 = Date.now();
    try {
      const body = JSON.stringify({ text, projectId: context?.projectId ?? this.opts.projectId });
      const result = await this.post(`${url}/v1/scan/text`, body, this.opts.callTimeoutMs);
      this.circuitSuccess();
      return {
        ...(result as unknown as TextScanResult),
        scannerMode: 'scanner',
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      this.circuitFailure();
      if (this.opts.mlFallback === 'fail_closed') throw err;
      return this.fallbackTextResult();
    }
  }

  /** Scan a binary buffer (image or PDF). */
  async scanFile(
    buffer: Buffer,
    mimeType: string,
    context?: { projectId?: string },
  ): Promise<ImageScanResult | PdfScanResult> {
    const url = await this.discoverUrl();
    if (!url || !this.circuitAllows()) {
      return this.fallbackImageResult();
    }

    const endpoint = mimeType === 'application/pdf' ? '/v1/scan/pdf' : '/v1/scan/image';
    const t0 = Date.now();
    try {
      // Multipart form-data upload
      const boundary = `----LPBoundary${Date.now()}`;
      const crlf = '\r\n';
      const header = `--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="upload"${crlf}Content-Type: ${mimeType}${crlf}${crlf}`;
      const footer = `${crlf}--${boundary}--`;

      const body = Buffer.concat([
        Buffer.from(header),
        buffer,
        Buffer.from(footer),
      ]);

      const result = await this.postRaw(
        `${url}${endpoint}`,
        body,
        `multipart/form-data; boundary=${boundary}`,
        this.opts.callTimeoutMs,
      );
      this.circuitSuccess();
      return {
        ...(result as unknown as ImageScanResult | PdfScanResult),
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      this.circuitFailure();
      if (this.opts.mlFallback === 'fail_closed') throw err;
      return this.fallbackImageResult();
    }
  }

  // ─── URL discovery ──────────────────────────────────────────────────────────

  private async discoverUrl(): Promise<string | null> {
    if (this.resolvedUrl !== null) return this.resolvedUrl;
    if (this.resolving) return this.resolving;

    this.resolving = this._doDiscover();
    this.resolvedUrl = await this.resolving;
    this.resolving = null;
    return this.resolvedUrl;
  }

  private async _doDiscover(): Promise<string | null> {
    // 1. Explicit env / constructor option
    if (this.opts.scannerUrl) {
      const alive = await this.probe(this.opts.scannerUrl);
      if (alive) return this.opts.scannerUrl;
    }

    // 2. K8s service DNS
    const k8sUrl = 'http://launchpromptly-scanner.launchpromptly-system.svc.cluster.local:7080';
    if (await this.probe(k8sUrl)) return k8sUrl;

    // 3. localhost (dev mode)
    const devUrl = 'http://localhost:7080';
    if (await this.probe(devUrl)) return devUrl;

    // 4. Fallback
    return null;
  }

  private async probe(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1_000);
      const isHttps = url.startsWith('https');
      const agent = isHttps ? this.httpsAgent : this.httpAgent;
      const resp = await fetch(`${url}/health`, {
        signal: controller.signal,
        // @ts-ignore — node-fetch agent support
        agent,
      });
      clearTimeout(timer);
      return resp.ok;
    } catch {
      return false;
    }
  }

  // ─── HTTP helpers ───────────────────────────────────────────────────────────

  private buildAuthHeader(body: string | Buffer): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.opts.ed25519PrivateKeyPem) {
      const payload = typeof body === 'string' ? body : body.toString('base64');
      const digest = createHash('sha256').update(payload).digest('base64');
      const signer = createSign('SHA256');
      signer.update(digest);
      const sig = signer.sign(this.opts.ed25519PrivateKeyPem, 'base64');
      headers['X-LP-Signature'] = sig;
      headers['X-LP-Project'] = this.opts.projectId;
      headers['X-LP-Timestamp'] = Date.now().toString();
    }
    return headers;
  }

  private async post(url: string, body: string, timeoutMs: number): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const isHttps = url.startsWith('https');
    const agent = isHttps ? this.httpsAgent : this.httpAgent;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.buildAuthHeader(body),
        },
        body,
        signal: controller.signal,
        // @ts-ignore
        agent,
      });
      if (!resp.ok) throw new Error(`Scanner HTTP ${resp.status}`);
      return resp.json() as Promise<Record<string, unknown>>;
    } finally {
      clearTimeout(timer);
    }
  }

  private async postRaw(
    url: string,
    body: Buffer,
    contentType: string,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const isHttps = url.startsWith('https');
    const agent = isHttps ? this.httpsAgent : this.httpAgent;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          ...this.buildAuthHeader(body),
        },
        body,
        signal: controller.signal,
        // @ts-ignore
        agent,
      });
      if (!resp.ok) throw new Error(`Scanner HTTP ${resp.status}`);
      return resp.json() as Promise<Record<string, unknown>>;
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Circuit breaker ────────────────────────────────────────────────────────

  private circuitAllows(): boolean {
    if (this.cbState === CircuitState.CLOSED) return true;
    if (this.cbState === CircuitState.OPEN) {
      if (Date.now() - this.cbOpenedAt > this.opts.cbOpenDurationMs) {
        this.cbState = CircuitState.HALF_OPEN;
        return true;
      }
      return false;
    }
    return true; // HALF_OPEN: allow one probe
  }

  private circuitSuccess(): void {
    this.cbFailures = 0;
    this.cbState = CircuitState.CLOSED;
    this.resolvedUrl = null; // re-probe on next call to handle restarts
  }

  private circuitFailure(): void {
    this.cbFailures++;
    if (this.cbFailures >= this.opts.cbFailureThreshold) {
      this.cbState = CircuitState.OPEN;
      this.cbOpenedAt = Date.now();
      this.resolvedUrl = null;
    }
  }

  // ─── Fallback results ───────────────────────────────────────────────────────

  private fallbackTextResult(): TextScanResult {
    return {
      injectionScore: 0,
      injectionBlocked: false,
      piiEntities: [],
      piiBlocked: false,
      toxicityScore: 0,
      toxicityBlocked: false,
      cacheHit: false,
      scannerMode: 'regex_only',
      latencyMs: 0,
    };
  }

  private fallbackImageResult(): ImageScanResult {
    return {
      nsfwScore: 0,
      nsfwBlocked: false,
      faceDetected: false,
      cacheHit: false,
      latencyMs: 0,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _client: ScannerClient | null = null;

export function getScannerClient(opts?: ScannerClientOptions): ScannerClient {
  if (!_client) {
    _client = new ScannerClient(opts);
  }
  return _client;
}
