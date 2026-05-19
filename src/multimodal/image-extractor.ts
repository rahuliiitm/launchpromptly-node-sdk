/**
 * ImageExtractor — processes image inputs into scanned MediaPart results.
 *
 * Pipeline:
 *   1. FileExtractor: load bytes + MIME validation
 *   2. ImagePrefilter: magic bytes, size limit, EXIF strip
 *   3. (optional) send to scanner for NSFW + face detection + OCR
 */

import type { MediaPart, ImageScanResult } from './types';
import { ImagePrefilter, computeSha256 } from './image-prefilter';
import { FileExtractor } from './file-extractor';

export class ImageExtractor {
  private prefilter: ImagePrefilter;
  private fileExtractor: FileExtractor;

  constructor(opts: { allowedMimes?: string[]; maxBytes?: number } = {}) {
    this.prefilter = new ImagePrefilter(opts);
    this.fileExtractor = new FileExtractor();
  }

  async fromBuffer(data: Buffer, mimeType: string, label?: string): Promise<MediaPart> {
    const part = await this.fileExtractor.fromBuffer(data, mimeType, label);
    return this.applyPrefilter(part);
  }

  async fromPath(filePath: string): Promise<MediaPart> {
    const part = await this.fileExtractor.fromPath(filePath);
    return this.applyPrefilter(part);
  }

  async fromDataUri(dataUri: string): Promise<MediaPart> {
    const part = await this.fileExtractor.fromDataUri(dataUri);
    return this.applyPrefilter(part);
  }

  async fromUrl(url: string): Promise<MediaPart> {
    const part = await this.fileExtractor.fromUrl(url);
    return this.applyPrefilter(part);
  }

  private applyPrefilter(part: MediaPart): MediaPart {
    const result = this.prefilter.check(part);
    if (!result.allowed) {
      throw new Error(`Image prefilter rejected: ${result.reason}`);
    }
    if (result.strippedData && !result.strippedData.equals(part.data)) {
      return {
        ...part,
        data: result.strippedData,
        sizeBytes: result.strippedData.length,
        sha256: computeSha256(result.strippedData),
      };
    }
    return part;
  }
}
