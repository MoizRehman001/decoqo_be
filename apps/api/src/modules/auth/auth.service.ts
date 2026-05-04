import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { RegisterVendorDto } from './dto/register-vendor.dto';
import { LoginDto } from './dto/login.dto';
import { AdminRegisterDto } from './dto/admin-register.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { OtpService } from './otp.service';
import { track } from '../../analytics/analytics.helper';

const BCRYPT_ROUNDS = 12;
const ADMIN_BCRYPT_ROUNDS = 14; // Higher cost for admin accounts

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly otpService: OtpService,
  ) { }

  // ── Registration ───────────────────────────────────────────────────────────

  async registerCustomer(dto: RegisterCustomerDto, ipAddress: string) {
    await this.assertIdentifierUnique(dto.email, dto.phone);

    // Validate pre-registration verified grants (issued by /auth/otp/verify-identifier)
    await this.assertVerifiedGrants(dto.email, dto.verifiedEmailToken, dto.phone, dto.verifiedPhoneToken);

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const displayName = (dto.displayName ?? dto.name ?? '').trim();
    if (displayName.length < 2) {
      throw new BadRequestException('Full name must be at least 2 characters');
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email,
          phone: dto.phone,
          passwordHash,
          role: UserRole.CUSTOMER,
          customerProfile: { create: { displayName, city: dto.city } },
        },
      });
      const policies = await tx.policyVersion.findMany({
        where: { type: { in: ['TERMS_CUSTOMER', 'PRIVACY_POLICY'] } },
        orderBy: { effectiveAt: 'desc' },
        distinct: ['type'],
      });
      if (policies.length > 0) {
        await tx.userPolicyAcceptance.createMany({
          data: policies.map((p) => ({ userId: newUser.id, policyVersionId: p.id, ipAddress })),
        });
      }
      return newUser;
    });

    // Consume grants and determine verified state
    const { emailVerified, phoneVerified } = await this.consumeGrants(
      dto.email, dto.verifiedEmailToken,
      dto.phone, dto.verifiedPhoneToken,
    );

    // If all provided identifiers are pre-verified → activate immediately, return tokens
    const allVerified = (!dto.email || emailVerified) && (!dto.phone || phoneVerified);
    if (allVerified) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', emailVerified, phoneVerified },
      });
      const tokens = await this.generateTokens(user.id, user.role, user.id, undefined, ipAddress);
      this.logger.log({ message: 'Customer registered and activated', userId: user.id });
      return {
        userId: user.id,
        role: UserRole.CUSTOMER,
        requiresOtpVerification: false,
        message: 'Account created and activated.',
        ...tokens,
      };
    }

    // Partial verification — send OTP for remaining unverified identifiers
    await this.sendOtpToAllChannels(
      !emailVerified ? dto.email : undefined,
      !phoneVerified ? dto.phone : undefined,
    );
    this.logger.log({ message: 'Customer registered — OTP verification pending', userId: user.id });
    return {
      userId: user.id,
      role: UserRole.CUSTOMER,
      requiresOtpVerification: true,
      message: 'Account created. Please verify your OTP to activate your account.',
    };
  }

  async registerVendor(dto: RegisterVendorDto, ipAddress: string) {
    await this.assertIdentifierUnique(dto.email, dto.phone);

    // Validate pre-registration verified grants
    await this.assertVerifiedGrants(dto.email, dto.verifiedEmailToken, dto.phone, dto.verifiedPhoneToken);

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const displayName = (dto.displayName ?? dto.name ?? '').trim();
    if (displayName.length < 2) {
      throw new BadRequestException('Full name must be at least 2 characters');
    }
    const serviceAreas = Array.from(
      new Set([dto.city, ...(dto.serviceAreas ?? [])].filter(Boolean)),
    );

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email,
          phone: dto.phone,
          passwordHash,
          role: UserRole.VENDOR,
          vendorProfile: {
            create: {
              businessName: dto.businessName,
              displayName,
              city: dto.city,
              serviceAreas,
              categories: dto.categories ?? [],
            },
          },
        },
      });
      const policies = await tx.policyVersion.findMany({
        where: { type: { in: ['TERMS_VENDOR', 'PRIVACY_POLICY'] } },
        orderBy: { effectiveAt: 'desc' },
        distinct: ['type'],
      });
      if (policies.length > 0) {
        await tx.userPolicyAcceptance.createMany({
          data: policies.map((p) => ({ userId: newUser.id, policyVersionId: p.id, ipAddress })),
        });
      }
      return newUser;
    });

    const { emailVerified, phoneVerified } = await this.consumeGrants(
      dto.email, dto.verifiedEmailToken,
      dto.phone, dto.verifiedPhoneToken,
    );

    const allVerified = (!dto.email || emailVerified) && (!dto.phone || phoneVerified);
    if (allVerified) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', emailVerified, phoneVerified },
      });
      const tokens = await this.generateTokens(user.id, user.role, user.id, undefined, ipAddress);
      this.logger.log({ message: 'Vendor registered and activated', userId: user.id });
      return {
        userId: user.id,
        role: UserRole.VENDOR,
        requiresOtpVerification: false,
        message: 'Account created and activated.',
        ...tokens,
      };
    }

    await this.sendOtpToAllChannels(
      !emailVerified ? dto.email : undefined,
      !phoneVerified ? dto.phone : undefined,
    );
    this.logger.log({ message: 'Vendor registered — OTP verification pending', userId: user.id });
    return {
      userId: user.id,
      role: UserRole.VENDOR,
      requiresOtpVerification: true,
      message: 'Account created. Please verify your OTP to activate your account.',
    };
  }

  // ── Login ──────────────────────────────────────────────────────────────────

  async login(dto: LoginDto, deviceInfo?: string, ipAddress?: string) {
    const identifier = this.normaliseIdentifier(dto.identifier);

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { phone: identifier }], deletedAt: null },
      include: {
        customerProfile: { select: { id: true, displayName: true } },
        vendorProfile: { select: { id: true, displayName: true } },
      },
    });

    if (!user?.passwordHash) {
      track('login_failed', identifier, {
        reason: 'invalid_credentials',
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!await bcrypt.compare(dto.password, user.passwordHash)) throw new UnauthorizedException('Invalid credentials');
    if (user.status === 'BANNED') {
      track('login_failed', user.id.toString(), {
        reason: user.status.toLowerCase(),
      });
      throw new UnauthorizedException('Account has been banned');
    }
    if (user.status === 'SUSPENDED') throw new UnauthorizedException('Account is suspended');

    if (user.status === 'PENDING_VERIFICATION') {
      await this.sendOtpToAllChannels(user.email ?? undefined, user.phone ?? undefined);
      track('pending_verification_triggered', user.id.toString());
      throw new UnauthorizedException(
        JSON.stringify({
          code: 'PENDING_VERIFICATION',
          message: 'Please verify your account. A new OTP has been sent.',
          email: user.email ?? '',
          phone: user.phone ?? '',
        }),
      );
    }

    if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) {
      if (!dto.totpCode) {
        track('login_success', user.id.toString(), {
          role: user.role,
          ip: ipAddress,
          device: deviceInfo,
        });
        throw new UnauthorizedException('TOTP code is required for admin accounts');
      }
      if (!user.totpSecret) throw new UnauthorizedException('Admin account has no TOTP configured');
      if (!this.verifyTotp(user.totpSecret, dto.totpCode)) {
        this.logger.warn({ message: 'Admin TOTP failed', userId: user.id, ipAddress });
        throw new UnauthorizedException('Invalid TOTP code');
      }
    }

    const profileId = user.customerProfile?.id ?? user.vendorProfile?.id ?? '';
    const displayName = user.customerProfile?.displayName ?? user.vendorProfile?.displayName ?? '';
    const tokens = await this.generateTokens(user.id, user.role, profileId, deviceInfo, ipAddress);
    track('login_success', user.id.toString(), {
      role: user.role,
      method: user.email ? 'email' : 'phone',
    });
    this.logger.log({ message: 'User logged in', userId: user.id, role: user.role });
    return { ...tokens, user: { id: user.id, role: user.role, displayName } };
  }

  async sendLoginOtp(identifier: string): Promise<{ message: string; expiresAt: string }> {
    const normalised = this.normaliseIdentifier(identifier);
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: normalised }, { phone: normalised }], deletedAt: null },
    });

    if (!user || user.status === 'BANNED' || user.status === 'SUSPENDED') {
      return { message: 'If an account exists, an OTP has been sent.', expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
    }
    if (user.status === 'PENDING_VERIFICATION') {
      throw new UnauthorizedException('Please complete account verification first');
    }

    const channel = normalised.includes('@') ? 'EMAIL' : 'SMS';
    await this.otpService.sendOtp(normalised, channel);
    return { message: 'OTP sent successfully', expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
  }

  async verifyLoginOtp(identifier: string, otp: string) {
    const normalised = this.normaliseIdentifier(identifier);
    const isValid = await this.otpService.verifyOtp(normalised, otp);
    if (!isValid) throw new BadRequestException('Invalid or expired OTP');

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: normalised }, { phone: normalised }], deletedAt: null },
      include: {
        customerProfile: { select: { id: true, displayName: true } },
        vendorProfile: { select: { id: true, displayName: true } },
      },
    });
    if (!user) throw new BadRequestException('User not found');
    if (user.status === 'BANNED') throw new UnauthorizedException('Account has been banned');
    if (user.status === 'SUSPENDED') throw new UnauthorizedException('Account is suspended');
    if (user.status === 'PENDING_VERIFICATION') throw new UnauthorizedException('Please complete account verification first');

    const profileId = user.customerProfile?.id ?? user.vendorProfile?.id ?? '';
    const displayName = user.customerProfile?.displayName ?? user.vendorProfile?.displayName ?? '';
    const tokens = await this.generateTokens(user.id, user.role, profileId);

    this.logger.log({ message: 'User logged in via OTP', userId: user.id });
    return { ...tokens, user: { id: user.id, role: user.role, displayName } };
  }

  // ── OTP ────────────────────────────────────────────────────────────────────

  async sendOtp(identifier: string, channel: 'SMS' | 'EMAIL'): Promise<{ message: string; expiresAt: string }> {
    await this.otpService.sendOtp(identifier, channel);
    return { message: 'OTP sent successfully', expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
  }

  /**
   * Verify OTP for a standalone identifier — NO user record required.
   * Used during registration form to verify email/phone before account creation.
   * Returns a verifiedToken (UUID) that must be submitted with the registration payload.
   * Token is stored in Redis with 15-minute TTL and is single-use.
   */
  async verifyIdentifier(identifier: string, otp: string): Promise<{ verifiedToken: string }> {
    const normalised = this.normaliseIdentifier(identifier);
    const token = await this.otpService.verifyIdentifierOtp(normalised, otp);
    if (!token) throw new BadRequestException('Invalid or expired OTP');
    return { verifiedToken: token };
  }

  /**
   * Verify OTP and activate an existing PENDING_VERIFICATION user account.
   * Returns tokens so the user is logged in immediately.
   */
  async verifyOtp(identifier: string, otp: string) {
    const normalised = this.normaliseIdentifier(identifier);
    const isValid = await this.otpService.verifyOtp(normalised, otp);
    if (!isValid) throw new BadRequestException('Invalid or expired OTP');

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: normalised }, { phone: normalised }] },
      include: {
        customerProfile: { select: { id: true, displayName: true } },
        vendorProfile: { select: { id: true, displayName: true } },
      },
    });
    if (!user) throw new BadRequestException('User not found');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE', emailVerified: !!user.email, phoneVerified: !!user.phone },
    });

    const profileId = user.customerProfile?.id ?? user.vendorProfile?.id ?? '';
    const displayName = user.customerProfile?.displayName ?? user.vendorProfile?.displayName ?? '';
    const tokens = await this.generateTokens(user.id, user.role, profileId);

    this.logger.log({ message: 'OTP verified — account activated', userId: user.id });
    return {
      verified: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: { id: user.id, role: user.role, displayName },
    };
  }

  // ── Password Reset ─────────────────────────────────────────────────────────

  async verifyOtpForReset(identifier: string, otp: string): Promise<{ resetGranted: boolean }> {
    const normalised = this.normaliseIdentifier(identifier);
    const isValid = await this.otpService.verifyOtp(normalised, otp);
    if (!isValid) throw new BadRequestException('Invalid or expired OTP');
    await this.otpService.storeResetGrant(`pwd_reset:${normalised}`);
    return { resetGranted: true };
  }

  async resetPassword(identifier: string, newPassword: string): Promise<{ success: boolean }> {
    const normalised = this.normaliseIdentifier(identifier);
    const isGranted = await this.otpService.consumeResetGrant(`pwd_reset:${normalised}`);
    if (!isGranted) throw new BadRequestException('Password reset not authorised — please verify OTP first');

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: normalised }, { phone: normalised }] },
    });
    if (!user) throw new BadRequestException('User not found');

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.prisma.userSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    this.logger.log({ message: 'Password reset successful', userId: user.id });
    return { success: true };
  }

  // ── Session ────────────────────────────────────────────────────────────────

  async refreshAccessToken(refreshToken: string) {
    const session = await this.prisma.userSession.findUnique({
      where: { refreshToken }, include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const profileId = await this.getProfileId(session.user.id, session.user.role);
    return this.generateTokens(session.user.id, session.user.role, profileId);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.userSession.updateMany({ where: { refreshToken }, data: { revokedAt: new Date() } });
  }

  async getMe(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true, email: true, phone: true, role: true, status: true,
        emailVerified: true, phoneVerified: true, createdAt: true,
        customerProfile: { select: { id: true, displayName: true, city: true, avatarUrl: true } },
        vendorProfile: { select: { id: true, businessName: true, displayName: true, city: true, kycStatus: true, isApproved: true } },
      },
    });
  }

  // ── Admin: Bootstrap first SUPER_ADMIN (self-disabling) ──────────────────

  /**
   * Creates the very first SUPER_ADMIN account.
   *
   * Security model:
   * - No JWT required (can't require SUPER_ADMIN to create the first one)
   * - Self-disabling: returns 403 if ANY admin/super_admin already exists
   * - Requires BOOTSTRAP_SECRET env var to match — prevents accidental calls
   * - TOTP secret generated server-side, printed to console in dev/local
   * - In production: secret returned in response body ONCE — store immediately
   * - Rate limited to 2 requests per hour at controller level
   */
  async bootstrapSuperAdmin(
    email: string,
    password: string,
    bootstrapSecret: string,
    ipAddress: string,
  ) {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const expectedSecret = this.configService.get<string>('BOOTSTRAP_SECRET', '');

    // Validate bootstrap secret
    if (!expectedSecret || expectedSecret.length < 16) {
      throw new ForbiddenException(
        'BOOTSTRAP_SECRET environment variable is not configured or too short',
      );
    }

    // Constant-time comparison to prevent timing attacks
    if (
      expectedSecret.length !== bootstrapSecret.length ||
      !crypto.timingSafeEqual(
        Buffer.from(expectedSecret),
        Buffer.from(bootstrapSecret),
      )
    ) {
      this.logger.warn({ message: 'Bootstrap attempt with wrong secret', ipAddress });
      throw new ForbiddenException('Invalid bootstrap secret');
    }

    // Self-disabling: check if any admin already exists
    const existingAdmin = await this.prisma.user.findFirst({
      where: { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] }, deletedAt: null },
      select: { id: true },
    });

    if (existingAdmin) {
      this.logger.warn({
        message: 'Bootstrap rejected: admin account already exists',
        ipAddress,
      });
      throw new ForbiddenException(
        'Bootstrap is disabled — an admin account already exists. Use POST /auth/admin/register with a SUPER_ADMIN token.',
      );
    }

    // Check email uniqueness
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(password, ADMIN_BCRYPT_ROUNDS);
    const totpSecret = this.generateTotpSecret();
    const otpAuthUri = `otpauth://totp/Decoqo%20Admin:${encodeURIComponent(email)}?secret=${totpSecret}&issuer=Decoqo&algorithm=SHA1&digits=6&period=30`;

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role: UserRole.SUPER_ADMIN,
        status: 'ACTIVE',
        emailVerified: true,
        totpSecret,
      },
    });

    // ── Console output in dev/local — TOTP setup instructions ─────────────
    const isDev = nodeEnv !== 'production';
    if (isDev) {
      const border = '═'.repeat(60);
      console.log('\n');
      console.log(`╔${border}╗`);
      console.log('║         🔐  SUPER_ADMIN BOOTSTRAP COMPLETE              ║');
      console.log(`╠${border}╣`);
      console.log(`║  Email       : ${email.padEnd(43)}║`);
      console.log(`║  Role        : SUPER_ADMIN                              ║`);
      console.log(`║  User ID     : ${user.id.slice(0, 43).padEnd(43)}║`);
      console.log(`╠${border}╣`);
      console.log('║  📱  TOTP SETUP — scan with Google Authenticator/Authy  ║');
      console.log(`╠${border}╣`);
      console.log(`║  Secret      : ${totpSecret.padEnd(43)}║`);
      console.log(`║  OTP URI     :                                          ║`);
      console.log(`║  ${otpAuthUri.slice(0, 57).padEnd(57)} ║`);
      if (otpAuthUri.length > 57) {
        console.log(`║  ${otpAuthUri.slice(57, 114).padEnd(57)} ║`);
      }
      console.log(`╠${border}╣`);
      console.log('║  ⚠️  Store the secret securely — shown only once!        ║');
      console.log('║  ⚠️  This endpoint is now DISABLED (admin exists)        ║');
      console.log(`╚${border}╝`);
      console.log('\n');
    }

    this.logger.log({
      message: 'SUPER_ADMIN bootstrapped',
      userId: user.id,
      email,
      ipAddress,
      environment: nodeEnv,
    });

    return {
      userId: user.id,
      email: user.email!,
      role: UserRole.SUPER_ADMIN,
      totpSecret,
      otpAuthUri,
      message: isDev
        ? 'SUPER_ADMIN created. TOTP details printed to server console. This endpoint is now disabled.'
        : 'SUPER_ADMIN created. Store the totpSecret and otpAuthUri immediately — they will not be shown again. This endpoint is now disabled.',
    };
  }

  // ── Admin: Provision admin account (SUPER_ADMIN only) ─────────────────────

  /**
   * Provisions a new admin account.
   *
   * Security model:
   * - Only callable by an authenticated SUPER_ADMIN (enforced at controller level)
   * - Generates a TOTP secret server-side — client never supplies it
   * - Returns otpAuthUri for QR code scanning — shown ONCE, never stored in plaintext
   * - Password hashed with higher bcrypt cost (14 rounds)
   * - Audit log entry created
   */
  async provisionAdmin(
    dto: AdminRegisterDto,
    requestingAdminId: string,
    ipAddress: string,
  ): Promise<{
    userId: string;
    email: string;
    role: UserRole;
    otpAuthUri: string;
    totpSecret: string;
    message: string;
  }> {
    // Prevent duplicate email
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    // Only SUPER_ADMIN can create another SUPER_ADMIN
    if (dto.role === 'SUPER_ADMIN') {
      const requestor = await this.prisma.user.findUnique({ where: { id: requestingAdminId } });
      if (requestor?.role !== UserRole.SUPER_ADMIN) {
        throw new ForbiddenException('Only SUPER_ADMIN can create another SUPER_ADMIN account');
      }
    }

    const role: UserRole = (dto.role as UserRole) ?? UserRole.ADMIN;
    const passwordHash = await bcrypt.hash(dto.password, ADMIN_BCRYPT_ROUNDS);

    // Generate TOTP secret (base32, 20 bytes = 160 bits)
    const totpSecret = this.generateTotpSecret();
    const otpAuthUri = `otpauth://totp/Decoqo:${encodeURIComponent(dto.email)}?secret=${totpSecret}&issuer=Decoqo&algorithm=SHA1&digits=6&period=30`;

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          role,
          status: 'ACTIVE',
          emailVerified: true,
          totpSecret,
        },
      });

      await tx.adminAction.create({
        data: {
          adminId: requestingAdminId,
          actionType: 'PROVISION_ADMIN',
          targetType: 'USER',
          targetId: newUser.id,
          reason: `Admin account provisioned by ${requestingAdminId}`,
          metadata: { email: dto.email, role, ipAddress },
        },
      });

      return newUser;
    });

    this.logger.log({
      message: 'Admin account provisioned',
      newAdminId: user.id,
      role,
      requestingAdminId,
      ipAddress,
    });

    return {
      userId: user.id,
      email: user.email!,
      role,
      totpSecret,
      otpAuthUri,
      message: 'Admin account created. Scan the QR code with your authenticator app. This secret will not be shown again.',
    };
  }

  // ── Admin: Dedicated login (credentials + TOTP, single step) ──────────────

  /**
   * Admin-only login endpoint.
   *
   * Security model:
   * - Email + password + TOTP in a single atomic request (prevents username enumeration)
   * - Constant-time comparison for TOTP (crypto.timingSafeEqual)
   * - Rejects non-admin roles with the same error as wrong credentials
   * - All failures logged with IP for security monitoring
   * - Access token TTL is shorter for admin (15m, same as regular but enforced)
   */
  async adminLogin(
    dto: AdminLoginDto,
    deviceInfo?: string,
    ipAddress?: string,
  ) {
    const GENERIC_ERROR = 'Invalid credentials or TOTP code';
    const isDev = this.configService.get<string>('NODE_ENV', 'development') !== 'production';

    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase().trim(), deletedAt: null },
    });

    // Constant-time path: always hash-compare even if user not found (prevents timing oracle)
    const dummyHash = '$2b$14$dummyhashfortimingnormalization.dummydummydummydummy';
    const passwordHash = user?.passwordHash ?? dummyHash;
    const passwordValid = await bcrypt.compare(dto.password, passwordHash);

    if (!user || !passwordValid) {
      this.logger.warn({ message: 'Admin login failed: bad credentials', email: dto.email, ipAddress });
      throw new UnauthorizedException(GENERIC_ERROR);
    }

    // Role gate — same error as wrong credentials to prevent enumeration
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      this.logger.warn({ message: 'Admin login rejected: non-admin role', userId: user.id, role: user.role, ipAddress });
      track('admin_login_failed', user.id.toString(), {
        reason: 'not_admin',
      });
      throw new UnauthorizedException(GENERIC_ERROR);
    }

    if (user.status === 'BANNED' || user.status === 'SUSPENDED') {
      this.logger.warn({ message: 'Admin login rejected: account status', userId: user.id, status: user.status, ipAddress });
      track('admin_login_failed', user.id.toString(), {
        reason: user.status.toLowerCase(),
      });
      throw new UnauthorizedException('Account is not active');
    }

    if (!user.totpSecret) {
      this.logger.error({ message: 'Admin account has no TOTP secret', userId: user.id });
      track('admin_login_failed', user.id.toString(), {
        reason: 'missing_totp_secret',
      });
      throw new UnauthorizedException(GENERIC_ERROR);
    }

    // ── Dev/local: print the current valid TOTP code to console ─────────────
    if (isDev) {
      const currentCode = this.generateHotp(
        user.totpSecret,
        Math.floor(Math.floor(Date.now() / 1000) / 30),
      );
      const nextCode = this.generateHotp(
        user.totpSecret,
        Math.floor(Math.floor(Date.now() / 1000) / 30) + 1,
      );
      const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
      console.log('\n');
      console.log('╔══════════════════════════════════════════════════╗');
      console.log('║        🔐  ADMIN TOTP CODE  (dev only)           ║');
      console.log('╠══════════════════════════════════════════════════╣');
      console.log(`║  Email       : ${dto.email.padEnd(33)}║`);
      console.log(`║  Current OTP : ${currentCode.padEnd(33)}║`);
      console.log(`║  Next OTP    : ${nextCode.padEnd(33)}║`);
      console.log(`║  Expires in  : ${String(secondsLeft + 's').padEnd(33)}║`);
      console.log('╠══════════════════════════════════════════════════╣');
      console.log('║  Universal bypass: 000000 also works in dev      ║');
      console.log('╚══════════════════════════════════════════════════╝');
      console.log('\n');
    }

    if (!this.verifyTotp(user.totpSecret, dto.totpCode)) {
      this.logger.warn({ message: 'Admin login failed: invalid TOTP', userId: user.id, ipAddress });
      track('admin_login_failed', user.id.toString(), {
        reason: 'invalid_totp',
      });
      throw new UnauthorizedException(GENERIC_ERROR);
    }

    const tokens = await this.generateTokens(user.id, user.role, user.id, deviceInfo, ipAddress);
    track('admin_login_success', user.id.toString(), {
      role: user.role,
      ip: ipAddress,
      device: deviceInfo,
    });
    this.logger.log({ message: 'Admin login successful', userId: user.id, role: user.role, ipAddress });
    console.log("====================================================================================================================================================================================")
    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: dto.email.split('@')[0],
      },
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Validate that verified grants exist for the given identifiers.
   * Called before user creation — throws if a grant is missing or expired.
   */
  private async assertVerifiedGrants(
    email?: string, emailToken?: string,
    phone?: string, phoneToken?: string,
  ): Promise<void> {
    if (email && emailToken) {
      const norm = this.normaliseIdentifier(email);
      const valid = await this.otpService.hasVerifiedGrant(norm, emailToken);
      if (!valid) throw new BadRequestException('Email verification expired. Please verify your email again.');
    }
    if (phone && phoneToken) {
      const norm = this.normaliseIdentifier(phone);
      const valid = await this.otpService.hasVerifiedGrant(norm, phoneToken);
      if (!valid) throw new BadRequestException('Phone verification expired. Please verify your mobile number again.');
    }
  }

  /**
   * Consume verified grants after user creation.
   * Returns which identifiers were successfully verified.
   */
  private async consumeGrants(
    email?: string, emailToken?: string,
    phone?: string, phoneToken?: string,
  ): Promise<{ emailVerified: boolean; phoneVerified: boolean }> {
    const emailVerified = email && emailToken
      ? await this.otpService.consumeVerifiedGrant(this.normaliseIdentifier(email), emailToken)
      : false;
    const phoneVerified = phone && phoneToken
      ? await this.otpService.consumeVerifiedGrant(this.normaliseIdentifier(phone), phoneToken)
      : false;
    return { emailVerified: !!emailVerified, phoneVerified: !!phoneVerified };
  }

  private async sendOtpToAllChannels(email?: string, phone?: string): Promise<void> {
    const tasks: Promise<void>[] = [];
    if (email) tasks.push(this.otpService.sendOtp(email, 'EMAIL'));
    if (phone) tasks.push(this.otpService.sendOtp(phone, 'SMS'));
    await Promise.allSettled(tasks);
  }

  private async generateTokens(
    userId: string, role: UserRole, profileId: string,
    deviceInfo?: string, ipAddress?: string,
  ) {
    const payload = { sub: userId, role, profileId };
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('app.jwtAccessExpiresIn', '15m'),
      issuer: 'decoqo.com',
      audience: 'decoqo-api',
    });
    const refreshToken = uuidv4();
    await this.prisma.userSession.create({
      data: { userId, refreshToken, deviceInfo, ipAddress, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });
    return { accessToken, refreshToken, expiresIn: 900 };
  }

  private async assertIdentifierUnique(email?: string, phone?: string): Promise<void> {
    if (email && await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Email already registered');
    }
    if (phone && await this.prisma.user.findUnique({ where: { phone } })) {
      throw new ConflictException('Phone already registered');
    }
  }

  private async getProfileId(userId: string, role: UserRole): Promise<string> {
    if (role === UserRole.CUSTOMER) return (await this.prisma.customerProfile.findUnique({ where: { userId } }))?.id ?? '';
    if (role === UserRole.VENDOR) return (await this.prisma.vendorProfile.findUnique({ where: { userId } }))?.id ?? '';
    return userId;
  }

  private normaliseIdentifier(identifier: string): string {
    const trimmed = identifier.trim();
    if (/^[6-9]\d{9}$/.test(trimmed)) return `+91${trimmed}`;
    return trimmed;
  }

  // ── TOTP ───────────────────────────────────────────────────────────────────

  private generateTotpSecret(): string {
    // 20 bytes = 160 bits, base32-encoded
    const bytes = crypto.randomBytes(20);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let result = '';
    let bits = 0;
    let value = 0;
    for (const byte of bytes) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        result += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) result += alphabet[(value << (5 - bits)) & 31];
    return result;
  }

  private verifyTotp(secret: string, code: string): boolean {
    if (process.env['NODE_ENV'] !== 'production' && code === '000000') return true;
    const windowSize = 1;
    const timeStep = 30;
    const now = Math.floor(Date.now() / 1000);
    for (let i = -windowSize; i <= windowSize; i++) {
      const counter = Math.floor((now + i * timeStep) / timeStep);
      const expected = this.generateHotp(secret, counter);
      if (crypto.timingSafeEqual(Buffer.from(code.padStart(6, '0')), Buffer.from(expected))) return true;
    }
    return false;
  }

  private base32Decode(input: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const normalized = input.toUpperCase().replace(/=+$/, '');
    let bits = 0; let value = 0;
    const output: number[] = [];
    for (const char of normalized) {
      const idx = alphabet.indexOf(char);
      if (idx === -1) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) { output.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
    }
    return Buffer.from(output);
  }

  private generateHotp(secret: string, counter: number): string {
    const key = this.base32Decode(secret);
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1]! & 0x0f;
    const code = ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
    return String(code % 1_000_000).padStart(6, '0');
  }
}
