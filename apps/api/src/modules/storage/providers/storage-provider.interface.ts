export interface UploadResult {
  url: string;
  key: string;
  provider: 'S3' | 'R2' | 'LOCAL';
}

export interface StorageProvider {
  readonly name: 'S3' | 'R2' | 'LOCAL';
  upload(params: {
    key: string;
    buffer: Buffer;
    mimeType: string;
    sizeBytes: number;
  }): Promise<UploadResult>;
  delete(key: string): Promise<void>;
  getSignedUrl?(key: string, expiresIn?: number): Promise<string>;
  getPublicUrl(key: string): string;
}
