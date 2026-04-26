import { IsEmail, IsString, MinLength, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Admin login DTO — credentials + TOTP in a single atomic request.
 *
 * Rationale for single-step vs two-step:
 * - Two-step leaks whether an email exists (timing oracle on step 1)
 * - Single-step prevents username enumeration
 * - TOTP is always required — no fallback path
 */
export class AdminLoginDto {
  @ApiProperty({ example: 'admin@decoqo.com' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  email: string = '';

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  password: string = '';

  @ApiProperty({
    example: '123456',
    description: '6-digit TOTP code from authenticator app — always required',
  })
  @IsString()
  @Length(6, 6, { message: 'TOTP must be exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'TOTP must contain only digits' })
  totpCode: string = '';
}
