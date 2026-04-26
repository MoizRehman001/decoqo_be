import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class RegisterCustomerDto {
  // ── Identity ──────────────────────────────────────────────────────────────

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  /**
   * Phone number — accepts either:
   *   - Full E.164 format:  +919876543210
   *   - 10-digit bare:       9876543210  (auto-prefixed with +91)
   */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed.startsWith('+91')) return trimmed;
    if (/^[6-9]\d{9}$/.test(trimmed)) return `+91${trimmed}`;
    return trimmed;
  })
  @Matches(/^\+91[6-9]\d{9}$/, { message: 'Phone must be a valid Indian mobile number' })
  phone?: string;

  // ── Password ──────────────────────────────────────────────────────────────

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain uppercase, lowercase, and a number',
  })
  password: string = '';

  // ── Profile ───────────────────────────────────────────────────────────────

  /**
   * displayName — the customer's display name.
   * Accepts either `displayName` or `name` from the frontend.
   * Made optional here because `name` is the alias sent by the form.
   * auth.service.ts resolves: displayName = dto.displayName || dto.name
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName?: string;

  /**
   * name — alias for displayName sent by the frontend form.
   * At least one of displayName or name must be provided (enforced in service).
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  // ── Policy acceptance ─────────────────────────────────────────────────────

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acceptedTerms?: boolean;

  // ── Pre-registration verified grant tokens ────────────────────────────────
  // Issued by POST /auth/otp/verify-identifier after inline OTP verification.
  // Passing these tokens activates the account immediately on registration.

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  verifiedEmailToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  verifiedPhoneToken?: string;
}
