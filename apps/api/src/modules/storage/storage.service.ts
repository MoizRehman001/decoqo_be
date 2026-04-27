import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { StorageSettingsService } from './storage-settings.service';
import { PrismaService } from '../../prisma/prisma.service';

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

export interface MultiUploadResult {
  fileKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storage: {
    s3?: string;
    r2?: string;
    local?: string;
  };
  primaryUrl: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly tempDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly settingsService: StorageSettingsService,
    private readonly prisma: PrismaService,
  ) {
    this.tempDir = path.resolve(
      this.configService.get('STORAGE_TEMP_DIR', './uploads/temp'),
    );
  }

  // ── Main upload entry point ────────────────────────────────────────────────

  async uploadFile(params: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    context: UploadContext;
    contextId: string;
    uploadedBy?: string;
  }): Promise<MultiUploadResult> {
    const start = Date.now();

    // 1. Validate mime type
    const allowed = ALLOWED_MIME_TYPES[params.context];
    if (!allowed.includes(params.mimeType)) {
      throw new BadRequestException(
        `File type ${params.mimeType} not allowed for ${params.context}`,
      );
    }

    // 2. Validate file size against DB setting
    const maxSize = await this.settingsService.getMaxFileSizeBytes();
    if (params.buffer.length > maxSize) {
      throw new BadRequestException(
        `File size ${params.buffer.length} bytes exceeds limit of ${maxSize} bytes`,
      );
    }

    // 3. Build file key
    const ext = params.originalName.split('.').pop() ?? 'bin';
    const fileKey = `${params.context}/${params.contextId}/${randomUUID()}.${ext}`;

    // 4. Get upload mode and providers
    const uploadMode = await this.settingsService.getUploadMode();
    const providers = await this.settingsService.getActiveProviders();

    if (providers.length === 0) {
      throw new BadRequestException('No storage providers are enabled. Contact admin.');
    }

    const storage: MultiUploadResult['storage'] = {};
    let tempPath: string | null = null;

    try {
      if (uploadMode === 'VM_ONLY') {
        // Store only on local VM
        const localProviders = providers.filter((p) => p.name === 'LOCAL');
        const target = localProviders[0] ?? providers[0];
        const result = await target?.upload({
          key: fileKey,
          buffer: params.buffer,
          mimeType: params.mimeType,
          sizeBytes: params.buffer.length,
        });
        storage.local = result?.url;
      } else if (uploadMode === 'VM_THEN_CLOUD') {
        // Write to temp first, then upload to all cloud providers
        tempPath = await this.writeTempFile(fileKey, params.buffer);

        const uploadPromises = providers.map(async (provider) => {
          try {
            const result = await provider.upload({
              key: fileKey,
              buffer: params.buffer,
              mimeType: params.mimeType,
              sizeBytes: params.buffer.length,
            });
            if (provider.name === 'S3') storage.s3 = result.url;
            if (provider.name === 'R2') storage.r2 = result.url;
            if (provider.name === 'LOCAL') storage.local = result.url;
          } catch (err) {
            this.logger.error({
              message: `Upload failed for provider ${provider.name}`,
              key: fileKey,
              error: (err as Error).message,
            });
            // Fallback to local if cloud fails
            if (provider.name !== 'LOCAL') {
              try {
                const localResult = await this.fallbackToLocal(fileKey, params.buffer, params.mimeType);
                storage.local = localResult;
                this.logger.warn({ message: 'Fell back to local storage', key: fileKey });
              } catch {
                // Local fallback also failed — log and continue
              }
            }
          }
        });

        await Promise.allSettled(uploadPromises);

        // Clean up temp file if configured
        const shouldDelete = await this.settingsService.shouldDeleteAfterUpload();
        if (shouldDelete && tempPath) {
          await fs.unlink(tempPath).catch(() => {});
          tempPath = null;
        }
      } else {
        // DIRECT_CLOUD — upload directly to all enabled providers
        const uploadPromises = providers.map(async (provider) => {
          const result = await provider.upload({
            key: fileKey,
            buffer: params.buffer,
            mimeType: params.mimeType,
            sizeBytes: params.buffer.length,
          });
          if (provider.name === 'S3') storage.s3 = result.url;
          if (provider.name === 'R2') storage.r2 = result.url;
          if (provider.name === 'LOCAL') storage.local = result.url;
        });
        await Promise.allSettled(uploadPromises);
      }
    } catch (err) {
      // Clean up temp on error
      if (tempPath) await fs.unlink(tempPath).catch(() => {});
      throw err;
    }

    const primaryUrl = storage.r2 ?? storage.s3 ?? storage.local ?? '';
    const durationMs = Date.now() - start;

    // Log to DB
    await this.logUpload({
      fileKey,
      originalName: params.originalName,
      mimeType: params.mimeType,
      sizeBytes: params.buffer.length,
      uploadMode,
      storage,
      success: !!primaryUrl,
      durationMs,
      uploadedBy: params.uploadedBy,
    });

    this.logger.log({
      message: 'File uploaded',
      fileKey,
      providers: Object.keys(storage),
      durationMs,
    });

    return {
      fileKey,
      originalName: params.originalName,
      mimeType: params.mimeType,
      sizeBytes: params.buffer.length,
      storage,
      primaryUrl,
    };
  }

  // ── Delete file from all providers ────────────────────────────────────────

  async deleteFile(fileKey: string): Promise<void> {
    const providers = await this.settingsService.getActiveProviders();
    await Promise.allSettled(providers.map((p) => p.delete(fileKey)));
    this.logger.log({ message: 'File deleted', fileKey });
  }

  // ── Presigned URL (legacy S3 flow — kept for backward compat) ─────────────

  async getPresignedUploadUrl(params: {
    context: UploadContext;
    contextId: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
  }): Promise<{ uploadUrl: string; fileKey: string; expiresIn: number }> {
    const maxSize = await this.settingsService.getMaxFileSizeBytes();
    if (params.fileSizeBytes > maxSize) {
      throw new BadRequestException(`File size exceeds limit of ${maxSize} bytes`);
    }

    const allowed = ALLOWED_MIME_TYPES[params.context];
    if (!allowed.includes(params.mimeType)) {
      throw new BadRequestException(`File type ${params.mimeType} not allowed`);
    }

    const ext = params.fileName.split('.').pop() ?? 'bin';
    const fileKey = `${params.context}/${params.contextId}/${randomUUID()}.${ext}`;

    const providers = await this.settingsService.getActiveProviders();
    const cloudProvider = providers.find((p) => p.name === 'R2' || p.name === 'S3');

    if (!cloudProvider?.getSignedUrl) {
      throw new BadRequestException('No cloud provider available for presigned URLs');
    }

    const uploadUrl = await cloudProvider.getSignedUrl(fileKey, 300);
    return { uploadUrl, fileKey, expiresIn: 300 };
  }

  getCdnUrl(fileKey: string): string {
    const r2PublicUrl = this.configService.get<string>('R2_PUBLIC_URL', '');
    if (r2PublicUrl) return `${r2PublicUrl}/${fileKey}`;
    const s3Bucket = this.configService.get<string>('AWS_S3_BUCKET', '');
    const region = this.configService.get<string>('AWS_REGION', 'ap-south-1');
    return `https://${s3Bucket}.s3.${region}.amazonaws.com/${fileKey}`;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async writeTempFile(key: string, buffer: Buffer): Promise<string> {
    const tempPath = path.join(this.tempDir, key.replace(/\//g, '_'));
    await fs.mkdir(path.dirname(tempPath), { recursive: true });
    await fs.writeFile(tempPath, buffer);
    return tempPath;
  }

  private async fallbackToLocal(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    const { LocalProvider } = await import('./providers/local.provider');
    const local = new LocalProvider(
      this.configService.get('STORAGE_LOCAL_DIR', './uploads'),
      this.configService.get('STORAGE_LOCAL_URL', 'http://localhost:3001/uploads'),
    );
    const result = await local.upload({ key, buffer, mimeType, sizeBytes: buffer.length });
    return result.url;
  }

  private async logUpload(params: {
    fileKey: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    uploadMode: string;
    storage: { s3?: string; r2?: string; local?: string };
    success: boolean;
    durationMs: number;
    uploadedBy?: string;
  }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    await db.storageUploadLog?.create({
      data: {
        fileKey: params.fileKey,
        originalName: params.originalName,
        mimeType: params.mimeType,
        sizeBytes: BigInt(params.sizeBytes),
        uploadMode: params.uploadMode,
        s3Url: params.storage.s3 ?? null,
        r2Url: params.storage.r2 ?? null,
        localPath: params.storage.local ?? null,
        success: params.success,
        durationMs: params.durationMs,
        uploadedBy: params.uploadedBy ?? null,
      },
    }).catch((err: Error) => {
      this.logger.error({ message: 'Failed to log upload', error: err.message });
    });
  }
}
