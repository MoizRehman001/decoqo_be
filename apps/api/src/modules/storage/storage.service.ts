import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

export type UploadContext =
  | 'floor-plans'
  | 'designs'
  | 'evidence'
  | 'dispute-evidence'
  | 'kyc'
  | 'boq-pdfs'
  | 'portfolio';

const ALLOWED_MIME_TYPES: Record<UploadContext, string[]> = {
  'floor-plans': ['image/jpeg', 'image/png', 'application/pdf'],
  designs: ['image/jpeg', 'image/png', 'image/webp'],
  evidence: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  'dispute-evidence': ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  kyc: ['image/jpeg', 'image/png', 'application/pdf'],
  'boq-pdfs': ['application/pdf'],
  portfolio: ['image/jpeg', 'image/png', 'image/webp'],
};

const MAX_SIZES_BYTES: Record<UploadContext, number> = {
  'floor-plans': 20 * 1024 * 1024,
  designs: 10 * 1024 * 1024,
  evidence: 10 * 1024 * 1024,
  'dispute-evidence': 10 * 1024 * 1024,
  kyc: 5 * 1024 * 1024,
  'boq-pdfs': 20 * 1024 * 1024,
  portfolio: 5 * 1024 * 1024,
};

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly configService: ConfigService) {
    this.client = new S3Client({
      region: configService.get<string>('aws.region', 'ap-south-1'),
      credentials: {
        accessKeyId: configService.get<string>('aws.accessKeyId', ''),
        secretAccessKey: configService.get<string>('aws.secretAccessKey', ''),
      },
    });
    this.bucket = configService.get<string>('aws.s3Bucket', '');
  }

  async getPresignedUploadUrl(params: {
    context: UploadContext;
    contextId: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
  }): Promise<{ uploadUrl: string; fileKey: string; expiresIn: number }> {
    this.validateUpload(params.mimeType, params.fileSizeBytes, params.context);

    const ext = params.fileName.split('.').pop() ?? 'bin';
    const fileKey = `${params.context}/${params.contextId}/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: fileKey,
      ContentType: params.mimeType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: 300 });

    return { uploadUrl, fileKey, expiresIn: 300 };
  }

  async getPresignedDownloadUrl(fileKey: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: fileKey });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  getCdnUrl(fileKey: string): string {
    return `https://${this.bucket}.s3.amazonaws.com/${fileKey}`;
  }

  private validateUpload(mimeType: string, sizeBytes: number, context: UploadContext): void {
    const allowed = ALLOWED_MIME_TYPES[context];
    if (!allowed.includes(mimeType)) {
      throw new Error(`File type ${mimeType} not allowed for ${context}`);
    }

    const maxSize = MAX_SIZES_BYTES[context];
    if (sizeBytes > maxSize) {
      throw new Error(`File size ${sizeBytes} exceeds limit ${maxSize} for ${context}`);
    }
  }
}
