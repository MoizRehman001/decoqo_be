import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsIn,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for admin account provisioning.
 *
 * Security constraints:
 * - Only SUPER_ADMIN can call this endpoint
 * - Password must meet complexity requirements
 * - Role is restricted to ADMIN or SUPER_ADMIN
 * - TOTP secret is generated server-side — never accepted from client
 */
export class AdminRegisterDto {
  @ApiProperty({ example: 'admin@decoqo.com', description: 'Admin email address' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  email: string = '';

  @ApiProperty({ example: 'Rahul Sharma', description: 'Admin display name' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName: string = '';

  @ApiProperty({
    example: 'Str0ng!Pass#2024',
    description: 'Password — min 12 chars, must include uppercase, lowercase, digit, and special char',
    minLength: 12,
  })
  @IsString()
  @MinLength(12, { message: 'Admin password must be at least 12 characters' })
  @MaxLength(128)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/,
    { message: 'Password must include uppercase, lowercase, digit, and special character' },
  )
  password: string = '';

  @ApiPropertyOptional({
    enum: ['ADMIN', 'SUPER_ADMIN'],
    default: 'ADMIN',
    description: 'Role — defaults to ADMIN. Only SUPER_ADMIN can create another SUPER_ADMIN.',
  })
  @IsOptional()
  @IsIn(['ADMIN', 'SUPER_ADMIN'], { message: 'Role must be ADMIN or SUPER_ADMIN' })
  role?: 'ADMIN' | 'SUPER_ADMIN';
}
