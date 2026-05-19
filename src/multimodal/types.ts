/**
 * Shared types for the multimodal module.
 */

export type MediaPartSource = 'user-upload' | 'url' | 'inline-base64' | 'filesystem';

export interface MediaPart {
  /** SHA-256 hex of the raw bytes — used for dedup and cache keying */
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  source: MediaPartSource;
  /** In-memory buffer — cleared after scanning */
  data: Buffer;
  /** Filename or URL if available */
  label?: string;
}

export interface ImageScanResult {
  sha256: string;
  mimeType: string;
  nsfwScore: number;
  nsfwBlocked: boolean;
  faceDetected: boolean;
  /** OCR-extracted text (may be spotlighted) */
  extractedText?: string;
  cacheHit: boolean;
  scannerMode: 'scanner' | 'prefilter_only';
  latencyMs: number;
}

export interface PdfScanResult {
  sha256: string;
  extractedText: string;
  pageCount: number;
  piiEntities: Array<{ type: string; score: number; start: number; end: number }>;
  injectionScore: number;
  injectionBlocked: boolean;
  cacheHit: boolean;
  latencyMs: number;
}

export interface FileScanResult {
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  allowed: boolean;
  reason?: string;
}
