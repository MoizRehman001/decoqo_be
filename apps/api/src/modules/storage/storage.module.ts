import { Global, Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { StorageService } from './storage.service';
import { StorageSettingsService } from './storage-settings.service';
import { StorageController, StorageAdminController } from './storage.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [
    PrismaModule,
    MulterModule.register({ limits: { fileSize: 500 * 1024 * 1024 } }), // 500 MB hard cap
  ],
  controllers: [StorageController, StorageAdminController],
  providers: [StorageService, StorageSettingsService],
  exports: [StorageService, StorageSettingsService],
})
export class StorageModule {}
