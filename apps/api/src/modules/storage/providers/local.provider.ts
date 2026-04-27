import { Logger } from '@nestjs/common';
import { StorageProvider, UploadResult } from './storage-provider.interface';
import * as fs from 'fs/promises';
import * as path from 'path';

export class LocalProvider implements StorageProvider {
  readonly name = 'LOCAL' as const;
  private readonly logger = new Logger(LocalProvider.name);
  private readonly baseDir: string;
  private readonly baseUrl: string;

  constructor(
    baseDir = './uploads',
    baseUrl = 'http://localhost:3001/uploads',
  ) {
    this.baseDir = path.resolve(baseDir);
    this.baseUrl = baseUrl;
  }

  async upload(params: {
    key: string;
    buffer: Buffer;
    mimeType: string;
    sizeBytes: number;
  }): Promise<UploadResult> {
    const filePath = path.join(this.baseDir, params.key);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, params.buffer);
    this.logger.log({ message: 'Local upload success', key: params.key, path: filePath });
    return {
      url: this.getPublicUrl(params.key),
      key: params.key,
      provider: 'LOCAL',
    };
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.baseDir, key);
    await fs.unlink(filePath).catch(() => {
      // Ignore if file doesn't exist
    });
  }

  getPublicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }
}
