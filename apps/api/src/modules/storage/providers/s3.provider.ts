import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Logger } from '@nestjs/common';
import { StorageProvider, UploadResult } from './storage-provider.interface';

export interface S3Config {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
  publicUrlBase?: string;
}

export class S3Provider implements StorageProvider {
  readonly name = 'S3' as const;
  private readonly client: S3Client;
  private readonly logger = new Logger(S3Provider.name);

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint && { endpoint: config.endpoint }),
    });
  }

  async upload(params: {
    key: string;
    buffer: Buffer;
    mimeType: string;
    sizeBytes: number;
  }): Promise<UploadResult> {
    const start = Date.now();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: params.key,
        Body: params.buffer,
        ContentType: params.mimeType,
        ContentLength: params.sizeBytes,
      }),
    );
    this.logger.log({
      message: 'S3 upload success',
      key: params.key,
      durationMs: Date.now() - start,
    });
    return {
      url: this.getPublicUrl(params.key),
      key: params.key,
      provider: 'S3',
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.config.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  getPublicUrl(key: string): string {
    if (this.config.publicUrlBase) return `${this.config.publicUrlBase}/${key}`;
    return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${key}`;
  }
}
