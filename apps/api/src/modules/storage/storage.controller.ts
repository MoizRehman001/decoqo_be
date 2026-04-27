import {
  Controller, Post, Delete, Get, Put, Body, Param,
  UseGuards, HttpCode, HttpStatus, UseInterceptors,
  UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { IsString, IsNumber, IsEnum, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { StorageService, UploadContext } from './storage.service';
import { StorageSettingsService } from './storage-settings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { memoryStorage } from 'multer';

class PresignUploadDto {
  @ApiProperty()
  @IsString()
  fileName: string = '';

  @ApiProperty()
  @IsString()
  mimeType: string = '';

  @ApiProperty()
  @IsNumber()
  @Min(1)
  fileSizeBytes: number = 0;

  @ApiProperty()
  @IsString()
  context: UploadContext = 'evidence';

  @ApiProperty()
  @IsString()
  contextId: string = '';
}

// ── Upload controller ──────────────────────────────────────────────────────

@ApiTags('uploads')
@ApiBearerAuth('access-token')
@Controller({ path: 'uploads', version: '1' })
@UseGuards(JwtAuthGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get pre-signed upload URL (cloud providers)' })
  async presign(@Body() dto: PresignUploadDto) {
    return this.storageService.getPresignedUploadUrl({
      context: dto.context,
      contextId: dto.contextId,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      fileSizeBytes: dto.fileSizeBytes,
    });
  }

  @Post('file')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Direct file upload — stored per active provider config' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        context: { type: 'string' },
        contextId: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('context') context: UploadContext,
    @Body('contextId') contextId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    if (!context) throw new BadRequestException('context is required');
    if (!contextId) throw new BadRequestException('contextId is required');

    return this.storageService.uploadFile({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      context,
      contextId,
      uploadedBy: user.sub,
    });
  }

  @Delete('file/:key(*)')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete file from all active providers' })
  async deleteFile(@Param('key') key: string) {
    await this.storageService.deleteFile(key);
    return { deleted: true, key };
  }
}

// ── Admin storage settings controller ─────────────────────────────────────

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller({ path: 'admin/storage', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class StorageAdminController {
  constructor(private readonly settingsService: StorageSettingsService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get storage settings (secrets masked)' })
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Put('settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update storage settings — no redeploy required' })
  updateSettings(
    @Body() dto: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.settingsService.updateSettings(dto as never, user.sub);
  }
}
