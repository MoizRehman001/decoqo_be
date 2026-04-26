import { Controller, Post, Get, Body, Req, Res, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity,
  ApiCreatedResponse, ApiOkResponse, ApiUnauthorizedResponse,
  ApiForbiddenResponse, ApiConflictResponse, ApiBadRequestResponse,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { RegisterVendorDto } from './dto/register-vendor.dto';
import { LoginDto } from './dto/login.dto';
import { AdminRegisterDto } from './dto/admin-register.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { BootstrapSuperAdminDto } from './dto/bootstrap-super-admin.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyIdentifierDto } from './dto/verify-identifier.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

const IS_PROD = process.env['NODE_ENV'] === 'production';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── Admin: Bootstrap first SUPER_ADMIN (self-disabling, no auth required) ──

  @Public()
  @Post('super-admin/bootstrap')
  @HttpCode(HttpStatus.CREATED)
  @ApiTags('admin-provisioning')
  @ApiOperation({
    summary: '🔑 Bootstrap first SUPER_ADMIN — self-disabling, no auth required',
    description: `
## One-Time Bootstrap Endpoint

Creates the **very first SUPER_ADMIN** account. This is the only way to get started
since you can't require a SUPER_ADMIN token to create the first one.

---

## ⚠️ Security Model

| Constraint | Detail |
|---|---|
| **Self-disabling** | Returns \`403\` immediately if ANY admin account already exists |
| **Bootstrap secret** | Must match the \`BOOTSTRAP_SECRET\` env variable (min 16 chars) |
| **Rate limited** | 2 requests per hour per IP |
| **TOTP** | Generated server-side — never supplied by client |
| **No JWT required** | Public endpoint — secured by bootstrap secret + self-disable |

---

## 📋 Setup Steps

### 1. Set environment variable
\`\`\`bash
# .env.local / .env.dev
BOOTSTRAP_SECRET=your-long-random-secret-here-min-16-chars
\`\`\`

### 2. Call this endpoint (Swagger or curl)
\`\`\`bash
curl -X POST http://localhost:3001/api/v1/auth/super-admin/bootstrap \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "superadmin@decoqo.com",
    "password": "Decoqo#SuperAdmin2024!",
    "bootstrapSecret": "your-long-random-secret-here-min-16-chars"
  }'
\`\`\`

### 3. Scan the QR code
- In **dev/local**: TOTP details are printed to the **server console** with a QR-scannable URI
- In **all environments**: \`totpSecret\` and \`otpAuthUri\` are returned in the response body
- Open the \`otpAuthUri\` in a browser or paste into Google Authenticator / Authy
- **Store the \`totpSecret\` securely — it is shown only once**

### 4. Login
Use \`POST /auth/admin/login\` with email + password + TOTP code from your authenticator app.

---

## 🔒 After Bootstrap

This endpoint **permanently disables itself** once any admin exists.
To create additional admins, use \`POST /auth/admin/register\` with a SUPER_ADMIN Bearer token.
    `.trim(),
  })
  @ApiCreatedResponse({
    description: 'SUPER_ADMIN created. TOTP details in response — store immediately.',
    schema: {
      type: 'object',
      properties: {
        userId:      { type: 'string', format: 'uuid', example: 'a1b2c3d4-e5f6-...' },
        email:       { type: 'string', example: 'superadmin@decoqo.com' },
        role:        { type: 'string', example: 'SUPER_ADMIN' },
        totpSecret:  {
          type: 'string',
          example: 'JBSWY3DPEHPK3PXP',
          description: 'Base32 TOTP secret — add to Google Authenticator / Authy. Shown ONCE.',
        },
        otpAuthUri:  {
          type: 'string',
          example: 'otpauth://totp/Decoqo%20Admin:superadmin%40decoqo.com?secret=JBSWY3DPEHPK3PXP&issuer=Decoqo',
          description: 'Scan with authenticator app or open in browser to add account.',
        },
        message:     { type: 'string', example: 'SUPER_ADMIN created. Store the totpSecret immediately.' },
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Bootstrap disabled (admin already exists) OR wrong bootstrap secret OR BOOTSTRAP_SECRET not configured',
  })
  @ApiConflictResponse({ description: 'Email already registered' })
  @ApiBadRequestResponse({ description: 'Validation error — check password complexity or bootstrap secret length' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded — 2 requests per hour' })
  @Throttle({ short: { limit: 2, ttl: 3_600_000 } }) // 2 per hour
  bootstrapSuperAdmin(@Body() dto: BootstrapSuperAdminDto, @Req() req: Request) {
    return this.authService.bootstrapSuperAdmin(
      dto.email,
      dto.password,
      dto.bootstrapSecret,
      req.ip ?? '',
    );
  }

  // ── Admin: Provision (Swagger-only, SUPER_ADMIN-gated) ────────────────────

  @Post('admin/register')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth('access-token')
  @ApiSecurity('super-admin-only')
  @ApiTags('admin-provisioning')
  @ApiOperation({
    summary: '[SUPER_ADMIN ONLY] Provision a new admin account',
    description: `
## ⚠️ Restricted Endpoint — SUPER_ADMIN Bearer Token Required

This endpoint is **only accessible via Swagger** and is not exposed in the public UI.

### How to use
1. Login as \`SUPER_ADMIN\` via \`POST /auth/admin/login\`
2. Click **Authorize** at the top of this page and paste the \`accessToken\`
3. Fill in the request body below and execute

### What happens
- A new admin account is created with the provided email and password
- A **TOTP secret** is generated server-side (never supplied by the client)
- The response includes an \`otpAuthUri\` — scan it with **Google Authenticator** or **Authy**
- **The secret is shown only once** — store it securely immediately
- All provisioning actions are written to the audit log

### Password requirements
- Minimum 12 characters
- Must include: uppercase letter, lowercase letter, digit, special character

### Security constraints
- Only \`SUPER_ADMIN\` can create another \`SUPER_ADMIN\`
- Rate limited: **3 requests per 5 minutes**
- All failures are logged with IP address
    `.trim(),
  })
  @ApiCreatedResponse({
    description: 'Admin account created. Scan the QR code immediately — secret shown only once.',
    schema: {
      type: 'object',
      properties: {
        userId:      { type: 'string', format: 'uuid', example: 'a1b2c3d4-...' },
        email:       { type: 'string', example: 'admin@decoqo.com' },
        role:        { type: 'string', enum: ['ADMIN', 'SUPER_ADMIN'], example: 'ADMIN' },
        totpSecret:  { type: 'string', example: 'JBSWY3DPEHPK3PXP', description: 'Base32 TOTP secret — store securely, shown once' },
        otpAuthUri:  { type: 'string', example: 'otpauth://totp/Decoqo:admin%40decoqo.com?secret=...', description: 'Scan with authenticator app' },
        message:     { type: 'string', example: 'Admin account created. Scan the QR code with your authenticator app.' },
      },
    },
  })
  @ApiConflictResponse({ description: 'Email already registered' })
  @ApiBadRequestResponse({ description: 'Validation error — check password complexity or role value' })
  @ApiForbiddenResponse({ description: 'Caller is not SUPER_ADMIN, or trying to create SUPER_ADMIN without SUPER_ADMIN role' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid Bearer token' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded — 3 requests per 5 minutes' })
  @Throttle({ short: { limit: 3, ttl: 300_000 } })
  provisionAdmin(
    @Body() dto: AdminRegisterDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.authService.provisionAdmin(dto, user.sub, req.ip ?? '');
  }

  // ── Admin: Dedicated login (credentials + TOTP, single step) ──────────────

  @Public()
  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  @ApiTags('admin-provisioning')
  @ApiOperation({
    summary: 'Admin login — email + password + TOTP (single atomic request)',
    description: `
## Admin-Only Login

Authenticates an \`ADMIN\` or \`SUPER_ADMIN\` account.

### Why single-step?
Submitting credentials and TOTP together prevents **username enumeration** — a two-step flow
reveals whether an email exists on step 1. Here, all three fields are validated atomically
and the same generic error is returned for any failure.

### TOTP setup
- Scan the \`otpAuthUri\` returned by \`POST /auth/admin/register\` with your authenticator app
- In **development**, use \`000000\` as a universal TOTP bypass

### On success
- Returns a short-lived \`accessToken\` (15 minutes)
- Sets a \`refresh_token\` httpOnly cookie (4 hours — shorter than regular users)

### Rate limiting
**5 requests per 5 minutes** per IP. All failures are logged.
    `.trim(),
  })
  @ApiOkResponse({
    description: 'Login successful — access token returned, refresh cookie set.',
    schema: {
      type: 'object',
      properties: {
        accessToken: { type: 'string', description: 'JWT access token (15 min TTL)' },
        expiresIn:   { type: 'number', example: 900, description: 'Seconds until access token expires' },
        user: {
          type: 'object',
          properties: {
            id:          { type: 'string', format: 'uuid' },
            email:       { type: 'string', example: 'admin@decoqo.com' },
            role:        { type: 'string', enum: ['ADMIN', 'SUPER_ADMIN'] },
            displayName: { type: 'string', example: 'admin' },
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials or TOTP code (generic — does not reveal which field failed)' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded — 5 requests per 5 minutes' })
  @Throttle({ short: { limit: 5, ttl: 300_000 } })
  async adminLogin(
    @Body() dto: AdminLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.adminLogin(dto, req.get('user-agent'), req.ip);
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'strict',
      maxAge: 4 * 60 * 60 * 1000,
      path: '/api/v1/auth/refresh',
    });
    const { refreshToken: _, ...response } = result;
    return response;
  }

  // ── Customer / Vendor registration ─────────────────────────────────────────

  @Public()
  @Post('register/customer')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register customer' })
  registerCustomer(@Body() dto: RegisterCustomerDto, @Req() req: Request) {
    return this.authService.registerCustomer(dto, req.ip ?? '');
  }

  @Public()
  @Post('register/vendor')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register vendor' })
  registerVendor(@Body() dto: RegisterVendorDto, @Req() req: Request) {
    return this.authService.registerVendor(dto, req.ip ?? '');
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto, req.get('user-agent'), req.ip);
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true, secure: IS_PROD, sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, path: '/api/v1/auth/refresh',
    });
    const { refreshToken: _, ...response } = result;
    return response;
  }

  @Public()
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send OTP to phone or email' })
  sendOtp(@Body() dto: SendOtpDto) {
    const channel = dto.identifier.includes('@') ? 'EMAIL' : 'SMS';
    return this.authService.sendOtp(dto.identifier, channel);
  }

  @Public()
  @Post('otp/verify-identifier')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify OTP for a standalone identifier (pre-registration)',
    description: 'No user account required. Returns a verifiedToken to pass during registration.',
  })
  verifyIdentifier(@Body() dto: VerifyIdentifierDto) {
    return this.authService.verifyIdentifier(dto.identifier, dto.otp);
  }

  @Public()
  @Post('otp/send-login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send OTP for passwordless login (only for verified accounts)' })
  sendLoginOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendLoginOtp(dto.identifier);
  }

  @Public()
  @Post('otp/verify-login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify OTP and login (passwordless)' })
  async verifyLoginOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyLoginOtp(dto.identifier, dto.otp);
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true, secure: IS_PROD, sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, path: '/api/v1/auth/refresh',
    });
    const { refreshToken: _, ...response } = result;
    return response;
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify OTP and activate account' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.identifier, dto.otp);
  }

  @Public()
  @Post('otp/verify-reset')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify OTP for password reset (does not activate account)' })
  verifyOtpForReset(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtpForReset(dto.identifier, dto.otp);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reset password after OTP verification' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.identifier, dto.newPassword);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.['refresh_token'] as string | undefined;
    if (!refreshToken) return { success: false, error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token' } };
    const result = await this.authService.refreshAccessToken(refreshToken);
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true, secure: IS_PROD, sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, path: '/api/v1/auth/refresh',
    });
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Logout — revokes refresh token and clears cookie' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.['refresh_token'] as string | undefined;
    if (refreshToken) {
      try {
        await this.authService.logout(refreshToken);
      } catch {
        // Ignore errors — always clear the cookie regardless
      }
    }
    res.clearCookie('refresh_token', { path: '/api/v1/auth/refresh' });
    res.clearCookie('refresh_token', { path: '/' });
    return { loggedOut: true };
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current user' })
  getMe(@CurrentUser() user: JwtPayload) {
    return this.authService.getMe(user.sub);
  }
}
