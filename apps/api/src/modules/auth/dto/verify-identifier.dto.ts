import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for pre-registration identifier OTP verification.
 * Used to verify email/phone BEFORE the user account is created.
 * Returns a verifiedToken that must be passed during registration.
 */
export class VerifyIdentifierDto {
  @ApiProperty({ example: 'user@example.com or +919876543210' })
  @IsString()
  identifier: string = '';

  @ApiProperty({ minLength: 6, maxLength: 6, example: '123456' })
  @IsString()
  @Length(6, 6)
  otp: string = '';
}
