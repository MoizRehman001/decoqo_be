import { IsString, MinLength, IsOptional, Length, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com', description: 'Email or phone' })
  @IsString() identifier: string = '';

  @ApiProperty({ minLength: 8 })
  @IsString() @MinLength(8) password: string = '';

  @ApiPropertyOptional({
    description: 'TOTP code — required for ADMIN and SUPER_ADMIN accounts',
    example: '123456',
  })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'TOTP code must be exactly 6 digits' })
  totpCode?: string;
}
