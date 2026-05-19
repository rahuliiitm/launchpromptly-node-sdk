/**
 * LaunchPromptly SDK — Multimodal module
 *
 * Provides MediaPart extraction and scanning for:
 *   - Images (MIME type, magic byte check, EXIF strip, NSFW + face via scanner)
 *   - PDFs  (text extraction via pdf-parse, deep scan via scanner)
 *   - Files (extension + MIME validation, hash dedup)
 *
 * Architecture:
 *   - SDK handles: MIME validation, magic byte check, size limits, EXIF strip, SHA-256 deduplicate
 *   - Scanner handles: OCR, NSFW, face detection, PDF deep-text, PII on extracted text
 *
 * License: BSL-1.1 (converts to Apache-2.0 after 4 years)
 */

export { MediaPart, MediaPartSource, ImageScanResult, PdfScanResult } from './types';
export { ImageExtractor } from './image-extractor';
export { PdfExtractor } from './pdf-extractor';
export { FileExtractor } from './file-extractor';
export { ImagePrefilter } from './image-prefilter';
export { MultimodalScanner } from './scanner';
