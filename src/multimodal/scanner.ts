/**
 * MultimodalScanner — orchestrates SDK-side pre-processing + scanner service calls.
 *
 * For images: prefilter → scanner /scan/image (NSFW, face, OCR)
 * For PDFs:   local text extract → scanner /scan/pdf (PII, injection on text)
 * For files:  type validation only (no scanner call for generic files)
 *
 * Deduplication: requests with the same sha256 within a session skip the scanner call.
 * The scanner itself has a Redis-backed verdict cache for cross-session dedup.
 */

import type { MediaPart, ImageScanResult, PdfScanResult, FileScanResult } from './types';
import { PdfExtractor } from './pdf-extractor';
import { ImagePrefilter } from './image-prefilter';
import type { ScannerClient } from '../scanner-client';

interface ScannerMultimodalConfig {
  scannerClient?: ScannerClient;
  /** NSFW threshold 0–1; images with score ≥ threshold are blocked */
  nsfwThreshold?: number;
  /** Whether to block images containing detected faces */
  blockFaces?: boolean;
  /** Max image size for scanner (larger images skip scanner and return prefilter-only) */
  maxImageBytesForScanner?: number;
}

export class MultimodalScanner {
  private scannerClient?: ScannerClient;
  private nsfwThreshold: number;
  private blockFaces: boolean;
  private maxImageBytesForScanner: number;
  private pdfExtractor: PdfExtractor;
  private imagePrefilter: ImagePrefilter;
  private sessionCache = new Map<string, unknown>();

  constructor(config: ScannerMultimodalConfig = {}) {
    this.scannerClient = config.scannerClient;
    this.nsfwThreshold = config.nsfwThreshold ?? 0.85;
    this.blockFaces = config.blockFaces ?? false;
    this.maxImageBytesForScanner = config.maxImageBytesForScanner ?? 20 * 1024 * 1024;
    this.pdfExtractor = new PdfExtractor();
    this.imagePrefilter = new ImagePrefilter();
  }

  async scanImage(part: MediaPart): Promise<ImageScanResult> {
    const t0 = Date.now();

    const cached = this.sessionCache.get(part.sha256);
    if (cached) return cached as ImageScanResult;

    const precheck = this.imagePrefilter.check(part);
    if (!precheck.allowed) {
      const result: ImageScanResult = {
        sha256: part.sha256,
        mimeType: part.mimeType,
        nsfwScore: 0,
        nsfwBlocked: false,
        faceDetected: false,
        cacheHit: false,
        scannerMode: 'prefilter_only',
        latencyMs: Date.now() - t0,
      };
      return result;
    }

    const effectivePart = precheck.strippedData
      ? { ...part, data: precheck.strippedData, sizeBytes: precheck.strippedData.length }
      : part;

    if (!this.scannerClient || effectivePart.sizeBytes > this.maxImageBytesForScanner) {
      const result: ImageScanResult = {
        sha256: effectivePart.sha256,
        mimeType: effectivePart.mimeType,
        nsfwScore: 0,
        nsfwBlocked: false,
        faceDetected: false,
        cacheHit: false,
        scannerMode: 'prefilter_only',
        latencyMs: Date.now() - t0,
      };
      this.sessionCache.set(part.sha256, result);
      return result;
    }

    try {
      const scanResult = await this.scannerClient.scanFile(effectivePart.data, effectivePart.mimeType);
      const sr = scanResult as unknown as Record<string, unknown>;
      const nsfwScore = (sr.nsfwScore as number | undefined) ?? 0;
      const faceDetected = (sr.faceDetected as boolean | undefined) ?? false;
      const extractedText = sr.extractedText as string | undefined;

      const result: ImageScanResult = {
        sha256: effectivePart.sha256,
        mimeType: effectivePart.mimeType,
        nsfwScore,
        nsfwBlocked: nsfwScore >= this.nsfwThreshold || (this.blockFaces && faceDetected),
        faceDetected,
        extractedText,
        cacheHit: (sr.cacheHit as boolean | undefined) ?? false,
        scannerMode: 'scanner',
        latencyMs: Date.now() - t0,
      };
      this.sessionCache.set(part.sha256, result);
      return result;
    } catch {
      // Scanner unavailable — fail open with prefilter-only result
      const result: ImageScanResult = {
        sha256: effectivePart.sha256,
        mimeType: effectivePart.mimeType,
        nsfwScore: 0,
        nsfwBlocked: false,
        faceDetected: false,
        cacheHit: false,
        scannerMode: 'prefilter_only',
        latencyMs: Date.now() - t0,
      };
      return result;
    }
  }

  async scanPdf(part: MediaPart): Promise<PdfScanResult> {
    const t0 = Date.now();

    const cached = this.sessionCache.get(part.sha256);
    if (cached) return cached as PdfScanResult;

    const extracted = await this.pdfExtractor.extract(part);

    if (!extracted.allowed) {
      const result: PdfScanResult = {
        sha256: part.sha256,
        extractedText: '',
        pageCount: 0,
        piiEntities: [],
        injectionScore: 0,
        injectionBlocked: false,
        cacheHit: false,
        latencyMs: Date.now() - t0,
      };
      return result;
    }

    if (!this.scannerClient || !extracted.text) {
      const result: PdfScanResult = {
        sha256: part.sha256,
        extractedText: extracted.spotlightedText,
        pageCount: extracted.pageCount,
        piiEntities: [],
        injectionScore: 0,
        injectionBlocked: false,
        cacheHit: false,
        latencyMs: Date.now() - t0,
      };
      this.sessionCache.set(part.sha256, result);
      return result;
    }

    try {
      const scanResult = await this.scannerClient.scanText(extracted.spotlightedText);
      const sr = scanResult as unknown as Record<string, unknown>;
      const result: PdfScanResult = {
        sha256: part.sha256,
        extractedText: extracted.spotlightedText,
        pageCount: extracted.pageCount,
        piiEntities: (sr.piiEntities as PdfScanResult['piiEntities'] | undefined) ?? [],
        injectionScore: (sr.injectionScore as number | undefined) ?? 0,
        injectionBlocked: (sr.blocked as boolean | undefined) ?? false,
        cacheHit: (sr.cacheHit as boolean | undefined) ?? false,
        latencyMs: Date.now() - t0,
      };
      this.sessionCache.set(part.sha256, result);
      return result;
    } catch {
      const result: PdfScanResult = {
        sha256: part.sha256,
        extractedText: extracted.spotlightedText,
        pageCount: extracted.pageCount,
        piiEntities: [],
        injectionScore: 0,
        injectionBlocked: false,
        cacheHit: false,
        latencyMs: Date.now() - t0,
      };
      return result;
    }
  }

  async scanFile(part: MediaPart): Promise<FileScanResult> {
    return {
      sha256: part.sha256,
      mimeType: part.mimeType,
      sizeBytes: part.sizeBytes,
      allowed: true,
    };
  }

  clearSessionCache(): void {
    this.sessionCache.clear();
  }
}
