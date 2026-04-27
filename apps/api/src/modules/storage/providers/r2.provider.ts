import { Logger } from '@nestjs/common';
import { S3Provider, S3Config } from './s3.provider';
import { StorageProvider, UploadResult } from './storage-provider.interface';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrlBase?: string;
}

/**
 * Cloudflare R2 is S3-compatible — we reuse S3Provider with the R2 endpoint.
 */
export class R2Provider implements StorageProvider {
  readonly name = 'R2' as const;
  private readonly inner: S3Provider;
  private readonly logger = new Logger(R2Provider.name);
  private readonly publicUrlBase: string;

  constructor(private readonly config: R2Config) {
    const s3Config: S3Config = {
      region: 'auto',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      bucket: config.bucket,
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      publicUrlBase: config.publicUrlBase,
    };
    this.inner = new S3Provider(s3Config);
    this.publicUrlBase = config.publicUrlBase ?? '';
  }

  async upload(params: {
    key: string;
    buffer: Buffer;
    mimeType: string;
    sizeBytes: number;
  }): Promise<UploadResult> {
    const result = await this.inner.upload(params);
    this.logger.log({ message: 'R2 upload success', key: params.key });
    return { ...result, provider: 'R2' };
  }

  async delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    return this.inner.getSignedUrl!(key, expiresIn);
  }

  getPublicUrl(key: string): string {
    if (this.publicUrlBase) return `${this.publicUrlBase}/${key}`;
    return `https://${this.config.accountId}.r2.cloudflarestorage.com/${this.config.bucket}/${key}`;
  }
}
