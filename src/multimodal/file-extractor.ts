/**
 * FileExtractor — converts raw file inputs into typed MediaPart objects.
 *
 * Handles:
 *   - Node.js Buffer + explicit MIME
 *   - File path (reads file, infers MIME from extension)
 *   - base64 data URIs (`data:<mime>;base64,<data>`)
 *   - URL fetching (with configurable timeout + size limits)
 *
 * Also enforces a global file-type blocklist (executables, archives, etc.)
 */

import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import * as path from 'path';
import type { MediaPart, MediaPartSource } from './types';

const MAX_URL_BYTES = 50 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const EXTENSION_MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif',
  '.bmp': 'image/bmp', '.tiff': 'image/tiff', '.tif': 'image/tiff',
  '.pdf': 'application/pdf',
};

const BLOCKED_MIMES = new Set([
  'application/x-msdownload', 'application/x-executable',
  'application/x-dosexec', 'application/x-sharedlib',
  'application/x-elf', 'application/zip', 'application/x-tar',
  'application/x-rar-compressed', 'application/x-7z-compressed',
  'text/x-shellscript',
]);

export class FileExtractor {
  async fromBuffer(data: Buffer, mimeType: string, label?: string): Promise<MediaPart> {
    this.guardMime(mimeType);
    return this.buildPart(data, mimeType, 'inline-base64', label);
  }

  async fromPath(filePath: string, mimeType?: string): Promise<MediaPart> {
    const data = await readFile(filePath);
    const inferredMime = mimeType ?? this.mimeFromPath(filePath);
    this.guardMime(inferredMime);
    return this.buildPart(data, inferredMime, 'filesystem', path.basename(filePath));
  }

  async fromDataUri(dataUri: string): Promise<MediaPart> {
    const match = dataUri.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) throw new Error('Invalid data URI format');
    const [, mime, b64] = match;
    const data = Buffer.from(b64, 'base64');
    this.guardMime(mime);
    return this.buildPart(data, mime, 'inline-base64');
  }

  async fromUrl(url: string, expectedMime?: string): Promise<MediaPart> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
      const contentType = expectedMime ?? resp.headers.get('content-type') ?? 'application/octet-stream';
      const mimeType = contentType.split(';')[0].trim();
      this.guardMime(mimeType);
      const buf = await resp.arrayBuffer();
      if (buf.byteLength > MAX_URL_BYTES) {
        throw new Error(`URL content too large: ${buf.byteLength} bytes (max ${MAX_URL_BYTES})`);
      }
      return this.buildPart(Buffer.from(buf), mimeType, 'url', url);
    } finally {
      clearTimeout(timer);
    }
  }

  private guardMime(mime: string): void {
    if (BLOCKED_MIMES.has(mime)) {
      throw new Error(`MIME type blocked for security: ${mime}`);
    }
  }

  private mimeFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_MIME_MAP[ext] ?? 'application/octet-stream';
  }

  private buildPart(data: Buffer, mimeType: string, source: MediaPartSource, label?: string): MediaPart {
    return {
      sha256: createHash('sha256').update(data).digest('hex'),
      mimeType,
      sizeBytes: data.length,
      source,
      data,
      label,
    };
  }
}
