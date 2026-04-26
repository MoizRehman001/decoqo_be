import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for bootstrapping the first SUPER_ADMIN account.
 *
 * This endpoint is self-disabling — it only works when NO admin accounts
 * exist in the database. Once any admin exists, it returns 403.
 *
 * Security constraints:
 * - No authentication required (can't require SUPER_ADMIN to create the first one)
 * - Disabled automatically once any ADMIN/SUPER_ADMIN account exists
 * - Rate limited to 2 requests per hour
 * - TOTP secret generated server-side, printed to console in dev/local only
 * - In production: TOTP secret is returned in response body ONCE — store immediately
 */
export class BootstrapSuperAdminDto {
  @ApiProperty({
    example: 'superadmin@decoqo.com',
    description: 'Email address for the SUPER_ADMIN account',
  })
  @IsEmail({}, { message: 'Must be a valid email address' })
  email: string = '';

  @ApiProperty({
    example: 'Decoqo#SuperAdmin2024!',
    description: [
      'Password — minimum 12 characters.',
      'Must include: uppercase, lowercase, digit, and special character (!@#$%^&* etc.)',
    ].join(' '),
    minLength: 12,
  })
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(128)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/,
    { message: 'Password must include uppercase, lowercase, digit, and special character' },
  )
  password: string = '';

  @ApiProperty({
    example: 'Decoqo Bootstrap Secret 2024',
    description: [
      'Bootstrap secret — must match the BOOTSTRAP_SECRET environment variable.',
      'Acts as a one-time password to prevent accidental or malicious bootstrapping.',
    ].join(' '),
  })
  @IsString()
  @MinLength(16, { message: 'Bootstrap secret must be at least 16 characters' })
  bootstrapSecret: string = '';
}
