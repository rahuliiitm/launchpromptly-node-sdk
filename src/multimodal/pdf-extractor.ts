/**
 * PdfExtractor — fast local PDF text extraction before sending to scanner.
 *
 * Uses pdf-parse (pure JS, no native deps) for lightweight extraction.
 * The scanner performs deeper analysis (NSFW, PII, injection on extracted text).
 *
 * Wraps extracted text in `<untrusted source="user">` tags to prevent
 * prompt injection via embedded PDF content (spotlighting).
 */

import { createHash } from 'crypto';
import type { MediaPart } from './types';

const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB
const PDF_MAGIC = Buffer.from('%PDF-');

export interface PdfExtractResult {
  text: string;
  pageCount: number;
  spotlightedText: string;
  sha256: string;
  allowed: boolean;
  reason?: string;
}

export class PdfExtractor {
  maxBytes: number;

  constructor(opts: { maxBytes?: number } = {}) {
    this.maxBytes = opts.maxBytes ?? MAX_PDF_BYTES;
  }

  async extract(part: MediaPart): Promise<PdfExtractResult> {
    const sha256 = createHash('sha256').update(part.data).digest('hex');

    if (part.sizeBytes > this.maxBytes) {
      return { text: '', pageCount: 0, spotlightedText: '', sha256, allowed: false, reason: `PDF too large: ${part.sizeBytes} bytes` };
    }

    if (!this.verifyPdfMagic(part.data)) {
      return { text: '', pageCount: 0, spotlightedText: '', sha256, allowed: false, reason: 'Not a valid PDF (magic bytes mismatch)' };
    }

    try {
      const pdfParse = await this.loadPdfParse();
      const parsed = await pdfParse(part.data, { max: 100 }); // max 100 pages for local extraction
      const text = parsed.text ?? '';
      const spotlightedText = this.spotlight(text, 'user-pdf');
      return {
        text,
        pageCount: parsed.numpages ?? 0,
        spotlightedText,
        sha256,
        allowed: true,
      };
    } catch (err) {
      // Extraction failure — still allowed (scanner does deep analysis)
      return { text: '', pageCount: 0, spotlightedText: '', sha256, allowed: true, reason: `Extraction failed: ${String(err)}` };
    }
  }

  private verifyPdfMagic(data: Buffer): boolean {
    return data.subarray(0, 5).equals(PDF_MAGIC);
  }

  private spotlight(text: string, source: string): string {
    return `<untrusted source="${source}">\n${text}\n</untrusted>`;
  }

  private async loadPdfParse(): Promise<(buf: Buffer, opts?: Record<string, unknown>) => Promise<{ text?: string; numpages?: number }>> {
    try {
      const mod = await import('pdf-parse' as string);
      return mod.default ?? mod;
    } catch {
      // pdf-parse not installed — return empty
      return async () => ({ text: '', numpages: 0 });
    }
  }
}
