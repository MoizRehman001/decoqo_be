import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsNumber, IsEnum, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { StorageService, UploadContext } from './storage.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

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

@ApiTags('uploads')
@ApiBearerAuth('access-token')
@Controller({ path: 'uploads', version: '1' })
@UseGuards(JwtAuthGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get pre-signed S3 upload URL' })
  async presign(@Body() dto: PresignUploadDto) {
    return this.storageService.getPresignedUploadUrl({
      context: dto.context,
      contextId: dto.contextId,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      fileSizeBytes: dto.fileSizeBytes,
    });
  }
}
