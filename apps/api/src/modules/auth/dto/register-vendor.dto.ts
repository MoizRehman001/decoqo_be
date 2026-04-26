import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsArray,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class RegisterVendorDto {
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
    // Already has +91 prefix
    if (trimmed.startsWith('+91')) return trimmed;
    // Bare 10-digit number — prepend +91
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

  // ── Business details ──────────────────────────────────────────────────────

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  businessName: string = '';

  /**
   * displayName — the vendor's personal display name.
   * Optional here because `name` is the alias sent by the frontend form.
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
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  /**
   * Primary city of operation.
   * Also accepted as a single-element serviceAreas entry.
   */
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city: string = '';

  /**
   * Additional service areas (cities) the vendor operates in.
   * The frontend city dropdown value is also included here automatically
   * in auth.service.ts so vendors can serve multiple cities.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceAreas?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  // ── Policy acceptance ─────────────────────────────────────────────────────

  /**
   * Frontend sends acceptedTerms: true — accepted and ignored server-side
   * (policy acceptance is recorded via UserPolicyAcceptance table).
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acceptedTerms?: boolean;

  // ── Pre-registration verified grant tokens ────────────────────────────────

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  verifiedEmailToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  verifiedPhoneToken?: string;
}
