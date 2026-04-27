import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Provider } from './providers/s3.provider';
import { R2Provider } from './providers/r2.provider';
import { LocalProvider } from './providers/local.provider';
import { StorageProvider } from './providers/storage-provider.interface';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ENCRYPTION_KEY_ENV = 'STORAGE_ENCRYPTION_KEY';
const ALGORITHM = 'aes-256-gcm';

export interface StorageSettingsDto {
  enableS3?: boolean;
  enableR2?: boolean;
  enableLocal?: boolean;
  uploadMode?: 'VM_THEN_CLOUD' | 'DIRECT_CLOUD' | 'VM_ONLY';
  maxFileSizeBytes?: number;
  deleteAfterUpload?: boolean;
  s3Config?: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicUrlBase?: string;
  };
  r2Config?: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicUrlBase?: string;
  };
}

@Injectable()
export class StorageSettingsService implements OnModuleInit {
  private readonly logger = new Logger(StorageSettingsService.name);
  private readonly encKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const keyHex = this.config.get<string>(ENCRYPTION_KEY_ENV, '');
    // Derive a 32-byte key from whatever is provided
    this.encKey = crypto.createHash('sha256').update(keyHex || 'decoqo-storage-default-key').digest();
  }

  // ── Encryption helpers ─────────────────────────────────────────────────────

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encKey, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  private decrypt(encoded: string): string {
    const buf = Buffer.from(encoded, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv(ALGORITHM, this.encKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  private encryptConfig(cfg: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg)) {
      // Encrypt sensitive fields
      if (['secretAccessKey', 'accessKeyId'].includes(k)) {
        result[k] = this.encrypt(v);
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  private decryptConfig(cfg: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg)) {
      if (['secretAccessKey', 'accessKeyId'].includes(k) && v) {
        try {
          result[k] = this.decrypt(v);
        } catch {
          result[k] = v; // fallback if not encrypted
        }
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  async onModuleInit() {
    try {
      await this.prisma.$executeRawUnsafe(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StorageUploadMode') THEN
            CREATE TYPE "StorageUploadMode" AS ENUM ('VM_THEN_CLOUD','DIRECT_CLOUD','VM_ONLY');
          END IF;
        END $$;
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS storage_settings (
          id TEXT NOT NULL PRIMARY KEY,
          "enableS3" BOOLEAN NOT NULL DEFAULT false,
          "enableR2" BOOLEAN NOT NULL DEFAULT true,
          "enableLocal" BOOLEAN NOT NULL DEFAULT false,
          "uploadMode" "StorageUploadMode" NOT NULL DEFAULT 'VM_THEN_CLOUD',
          "maxFileSizeBytes" BIGINT NOT NULL DEFAULT 10485760,
          "deleteAfterUpload" BOOLEAN NOT NULL DEFAULT true,
          "s3Config" JSONB,
          "r2Config" JSONB,
          "updatedBy" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS storage_upload_logs (
          id TEXT NOT NULL PRIMARY KEY,
          "fileKey" TEXT NOT NULL,
          "originalName" TEXT NOT NULL,
          "mimeType" TEXT NOT NULL,
          "sizeBytes" BIGINT NOT NULL,
          "uploadMode" TEXT NOT NULL,
          "s3Url" TEXT,
          "r2Url" TEXT,
          "localPath" TEXT,
          success BOOLEAN NOT NULL DEFAULT true,
          "errorMessage" TEXT,
          "durationMs" INTEGER,
          "uploadedBy" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.logger.log('Storage tables ensured');
    } catch (err) {
      this.logger.error({ message: 'Failed to ensure storage tables', error: (err as Error).message });
    }
  }

  async getSettings() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    let settings = await db.storageSettings?.findFirst({
      orderBy: { createdAt: 'desc' },
    }).catch(() => null);

    if (!settings) {
      settings = await this.seedDefaults();
    }

    // Convert BigInt → Number for JSON serialization
    if (settings?.maxFileSizeBytes !== undefined) {
      settings = { ...settings, maxFileSizeBytes: Number(settings.maxFileSizeBytes) };
    }

    // Mask secrets in response
    const safe = { ...settings };
    if (safe.s3Config) {
      const cfg = safe.s3Config as Record<string, string>;
      safe.s3Config = { ...cfg, secretAccessKey: '***', accessKeyId: cfg.accessKeyId ? '***' : '' };
    }
    if (safe.r2Config) {
      const cfg = safe.r2Config as Record<string, string>;
      safe.r2Config = { ...cfg, secretAccessKey: '***', accessKeyId: cfg.accessKeyId ? '***' : '' };
    }
    return safe;
  }

  async updateSettings(dto: StorageSettingsDto, adminId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    const existing = await db.storageSettings?.findFirst({ orderBy: { createdAt: 'desc' } }).catch(() => null);

    const s3Config = dto.s3Config
      ? this.encryptConfig(dto.s3Config as unknown as Record<string, string>)
      : undefined;
    const r2Config = dto.r2Config
      ? this.encryptConfig(dto.r2Config as unknown as Record<string, string>)
      : undefined;

    const data = {
      ...(dto.enableS3 !== undefined && { enableS3: dto.enableS3 }),
      ...(dto.enableR2 !== undefined && { enableR2: dto.enableR2 }),
      ...(dto.enableLocal !== undefined && { enableLocal: dto.enableLocal }),
      ...(dto.uploadMode && { uploadMode: dto.uploadMode }),
      ...(dto.maxFileSizeBytes !== undefined && { maxFileSizeBytes: BigInt(dto.maxFileSizeBytes) }),
      ...(dto.deleteAfterUpload !== undefined && { deleteAfterUpload: dto.deleteAfterUpload }),
      ...(s3Config && { s3Config }),
      ...(r2Config && { r2Config }),
      updatedBy: adminId,
    };

    let result;
    if (existing) {
      result = await db.storageSettings.update({ where: { id: existing.id }, data });
    } else {
      result = await db.storageSettings.create({ data: { ...data, id: require('crypto').randomUUID() } });
    }

    // Convert BigInt → Number before returning
    return { ...result, maxFileSizeBytes: Number(result.maxFileSizeBytes) };
  }

  // ── Provider factory ───────────────────────────────────────────────────────

  async getActiveProviders(): Promise<StorageProvider[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    const settings = await db.storageSettings?.findFirst({ orderBy: { createdAt: 'desc' } }).catch(() => null);

    if (!settings) return this.getFallbackProviders();

    const providers: StorageProvider[] = [];

    if (settings.enableS3 && settings.s3Config) {
      try {
        const cfg = this.decryptConfig(settings.s3Config as Record<string, string>);
        providers.push(new S3Provider({
          region: cfg['region'] ?? 'ap-south-1',
          accessKeyId: cfg['accessKeyId'] ?? '',
          secretAccessKey: cfg['secretAccessKey'] ?? '',
          bucket: cfg['bucket'] ?? '',
          publicUrlBase: cfg['publicUrlBase'],
        }));
      } catch (e) {
        this.logger.error({ message: 'Failed to init S3 provider', error: (e as Error).message });
      }
    }

    if (settings.enableR2 && settings.r2Config) {
      try {
        const cfg = this.decryptConfig(settings.r2Config as Record<string, string>);
        providers.push(new R2Provider({
          accountId: cfg['accountId'] ?? '',
          accessKeyId: cfg['accessKeyId'] ?? '',
          secretAccessKey: cfg['secretAccessKey'] ?? '',
          bucket: cfg['bucket'] ?? '',
          publicUrlBase: cfg['publicUrlBase'],
        }));
      } catch (e) {
        this.logger.error({ message: 'Failed to init R2 provider', error: (e as Error).message });
      }
    }

    if (settings.enableLocal) {
      providers.push(new LocalProvider(
        this.config.get('STORAGE_LOCAL_DIR', './uploads'),
        this.config.get('STORAGE_LOCAL_URL', 'http://localhost:3001/uploads'),
      ));
    }

    if (providers.length === 0) {
      this.logger.warn('No storage providers enabled — falling back to R2 from env');
      return this.getFallbackProviders();
    }

    return providers;
  }

  async getUploadMode(): Promise<'VM_THEN_CLOUD' | 'DIRECT_CLOUD' | 'VM_ONLY'> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    const settings = await db.storageSettings?.findFirst({ orderBy: { createdAt: 'desc' } }).catch(() => null);
    return settings?.uploadMode ?? 'VM_THEN_CLOUD';
  }

  async getMaxFileSizeBytes(): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    const settings = await db.storageSettings?.findFirst({ orderBy: { createdAt: 'desc' } }).catch(() => null);
    return Number(settings?.maxFileSizeBytes ?? 10 * 1024 * 1024);
  }

  async shouldDeleteAfterUpload(): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    const settings = await db.storageSettings?.findFirst({ orderBy: { createdAt: 'desc' } }).catch(() => null);
    return settings?.deleteAfterUpload ?? true;
  }

  // ── Fallback: use env vars ─────────────────────────────────────────────────

  private getFallbackProviders(): StorageProvider[] {
    const r2AccountId = this.config.get<string>('R2_ACCOUNT_ID', '');
    const r2AccessKey = this.config.get<string>('R2_ACCESS_KEY_ID', '');
    const r2Secret = this.config.get<string>('R2_SECRET_ACCESS_KEY', '');
    const r2Bucket = this.config.get<string>('R2_BUCKET_NAME', '');
    const r2PublicUrl = this.config.get<string>('R2_PUBLIC_URL', '');

    if (r2AccountId && r2AccessKey && r2Secret && r2Bucket) {
      return [new R2Provider({
        accountId: r2AccountId,
        accessKeyId: r2AccessKey,
        secretAccessKey: r2Secret,
        bucket: r2Bucket,
        publicUrlBase: r2PublicUrl,
      })];
    }

    const s3Key = this.config.get<string>('AWS_ACCESS_KEY_ID', '');
    const s3Secret = this.config.get<string>('AWS_SECRET_ACCESS_KEY', '');
    const s3Bucket = this.config.get<string>('AWS_S3_BUCKET', '');
    if (s3Key && s3Secret && s3Bucket) {
      return [new S3Provider({
        region: this.config.get<string>('AWS_REGION', 'ap-south-1'),
        accessKeyId: s3Key,
        secretAccessKey: s3Secret,
        bucket: s3Bucket,
      })];
    }

    // Last resort: local
    return [new LocalProvider()];
  }

  private async seedDefaults() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    const r2AccountId = this.config.get<string>('R2_ACCOUNT_ID', '');
    const hasR2 = !!r2AccountId;

    const r2Config = hasR2 ? this.encryptConfig({
      accountId: this.config.get<string>('R2_ACCOUNT_ID', ''),
      accessKeyId: this.config.get<string>('R2_ACCESS_KEY_ID', ''),
      secretAccessKey: this.config.get<string>('R2_SECRET_ACCESS_KEY', ''),
      bucket: this.config.get<string>('R2_BUCKET_NAME', ''),
      publicUrlBase: this.config.get<string>('R2_PUBLIC_URL', ''),
    }) : null;

    return db.storageSettings?.create({
      data: {
        enableS3: false,
        enableR2: hasR2,
        enableLocal: !hasR2,
        uploadMode: 'VM_THEN_CLOUD',
        maxFileSizeBytes: BigInt(10 * 1024 * 1024),
        deleteAfterUpload: true,
        r2Config,
      },
    }).catch(() => null);
  }
}
