import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import axios from 'axios';
import * as nodemailer from 'nodemailer';
import * as crypto from 'crypto';
import { REDIS_CLIENT } from '../../common/interceptors/idempotency.interceptor';

const OTP_TTL = 300;           // 5 minutes
const MAX_ATTEMPTS = 3;
const RATE_LIMIT_WINDOW = 3600; // 1 hour
const RATE_LIMIT_MAX = 3;       // max 3 OTPs per hour per identifier

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) { }

  // ── Public API ─────────────────────────────────────────────────────────────

  async sendOtp(identifier: string, channel: 'SMS' | 'EMAIL'): Promise<void> {
    // Rate limiting — max RATE_LIMIT_MAX OTPs per identifier per hour
    const countKey = `otp:count:${identifier}`;
    const count = await this.redis.incr(countKey);
    if (count === 1) await this.redis.expire(countKey, RATE_LIMIT_WINDOW);
    if (count > RATE_LIMIT_MAX) {
      this.logger.warn({ message: 'OTP rate limit exceeded', identifier: this.mask(identifier) });
      return;
    }

    const otp = Math.floor(100_000 + Math.random() * 900_000).toString();
    await this.redis.setex(`otp:${identifier}`, OTP_TTL, JSON.stringify({ otp, attempts: 0 }));

    // ── Always log OTP to console in non-production (dev / local / test) ──────
    if (process.env['NODE_ENV'] !== 'production') {
      this.logger.log(
        `\n${'═'.repeat(50)}\n` +
        `  🔑  DEV OTP\n` +
        `  Identifier : ${this.mask(identifier)}\n` +
        `  Channel    : ${channel}\n` +
        `  OTP Code   : ${otp}\n` +
        `  Expires in : 5 minutes\n` +
        `${'═'.repeat(50)}`,
      );
    }

    if (channel === 'SMS') {
      await this.sendSms(identifier, otp);
    } else {
      await this.sendEmailOtp(identifier, otp);
    }

    this.logger.log({ message: 'OTP sent', identifier: this.mask(identifier), channel });
  }

  async verifyOtp(identifier: string, otp: string): Promise<boolean> {
    const raw = await this.redis.get(`otp:${identifier}`);
    if (!raw) return false;

    const data = JSON.parse(raw) as { otp: string; attempts: number };

    if (data.attempts >= MAX_ATTEMPTS) {
      await this.redis.del(`otp:${identifier}`);
      return false;
    }

    if (data.otp !== otp) {
      data.attempts += 1;
      await this.redis.setex(`otp:${identifier}`, OTP_TTL, JSON.stringify(data));
      return false;
    }

    await this.redis.del(`otp:${identifier}`);
    return true;
  }

  /**
   * Verify OTP for a standalone identifier (pre-registration).
   * On success, stores a short-lived "verified grant" in Redis and returns
   * a verifiedToken that the registration endpoint can validate.
   *
   * Pattern: verify identifier → get proof token → use token during registration.
   * No user record is required to exist.
   *
   * @returns verifiedToken — a UUID the client passes back during registration
   */
  async verifyIdentifierOtp(identifier: string, otp: string): Promise<string | null> {
    const isValid = await this.verifyOtp(identifier, otp);
    if (!isValid) return null;

    // Issue a short-lived verified grant (15 minutes)
    const token = crypto.randomUUID();
    const grantKey = `verified:${identifier}`;
    await this.redis.setex(grantKey, 900, token);

    this.logger.log({ message: 'Identifier verified', identifier: this.mask(identifier) });
    return token;
  }

  /**
   * Validate a verified grant token for a given identifier.
   * Consumes the grant (one-time use) and returns true if valid.
   */
  async consumeVerifiedGrant(identifier: string, token: string): Promise<boolean> {
    const grantKey = `verified:${identifier}`;
    const stored = await this.redis.get(grantKey);
    if (!stored || stored !== token) return false;
    await this.redis.del(grantKey);
    return true;
  }

  /**
   * Check if a verified grant exists for an identifier (non-consuming).
   * Used to validate during registration without consuming the grant prematurely.
   */
  async hasVerifiedGrant(identifier: string, token: string): Promise<boolean> {
    const grantKey = `verified:${identifier}`;
    const stored = await this.redis.get(grantKey);
    return stored === token;
  }

  // ── Email — SMTP (Gmail) primary, AWS SES fallback ─────────────────────────

  private async sendEmailOtp(email: string, otp: string): Promise<void> {
    const smtpHost = this.configService.get<string>('app.smtp.host', '');
    const smtpUser = this.configService.get<string>('app.smtp.user', '');
    const smtpPassword = this.configService.get<string>('app.smtp.password', '');
    const smtpFrom = this.configService.get<string>('app.smtp.from', smtpUser);
    const smtpPort = this.configService.get<number>('app.smtp.port', 465);

    // ── Primary: Gmail SMTP ──────────────────────────────────────────────────
    if (smtpHost && smtpUser && smtpPassword) {
      try {
        await this.sendViaSmtp({ host: smtpHost, port: smtpPort, user: smtpUser, password: smtpPassword, from: smtpFrom }, email, otp);
        return;
      } catch (err) {
        this.logger.error({ message: 'SMTP email failed, trying SES fallback', error: (err as Error).message });
      }
    }

    // ── Fallback: AWS SES ────────────────────────────────────────────────────
    const accessKeyId = this.configService.get<string>('aws.accessKeyId', '');
    const secretAccessKey = this.configService.get<string>('aws.secretAccessKey', '');

    if (accessKeyId && secretAccessKey) {
      try {
        await this.sendViaSes(email, otp);
        return;
      } catch (err) {
        this.logger.error({ message: 'SES email failed', error: (err as Error).message });
      }
    }

    // ── Dev fallback: log to console ─────────────────────────────────────────
    this.logger.warn({
      message: '⚠️  No email transport configured — OTP logged to console (dev only)',
      email: this.mask(email),
      otp,
    });
  }

  private async sendViaSmtp(
    config: { host: string; port: number; user: string; password: string; from: string },
    to: string,
    otp: string,
  ): Promise<void> {
    const secure = config.port === 465; // SSL for port 465, STARTTLS for 587

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure,
      auth: {
        user: config.user,
        pass: config.password,
      },
      // Gmail-specific: allow less secure apps or use App Password
      tls: {
        rejectUnauthorized: process.env['NODE_ENV'] === 'production',
      },
    });

    await transporter.sendMail({
      from: `Decoqo <${config.from}>`,
      to,
      subject: `${otp} is your Decoqo verification code`,
      html: this.buildOtpEmailHtml(otp),
      text: `Your Decoqo verification code is: ${otp}. Expires in 5 minutes. Never share this code.`,
    });

    this.logger.debug({ message: 'OTP email sent via SMTP', to: this.mask(to) });
  }

  private async sendViaSes(email: string, otp: string): Promise<void> {
    const fromEmail = this.configService.get<string>('aws.sesFromEmail', 'noreply@decoqo.com');
    const awsRegion = this.configService.get<string>('aws.region', 'ap-south-1');
    const accessKeyId = this.configService.get<string>('aws.accessKeyId', '');
    const secretAccessKey = this.configService.get<string>('aws.secretAccessKey', '');

    const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
    const ses = new SESClient({
      region: awsRegion,
      credentials: { accessKeyId, secretAccessKey },
    });

    await ses.send(new SendEmailCommand({
      Source: `Decoqo <${fromEmail}>`,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: `${otp} is your Decoqo verification code`, Charset: 'UTF-8' },
        Body: {
          Html: { Data: this.buildOtpEmailHtml(otp), Charset: 'UTF-8' },
          Text: { Data: `Your Decoqo verification code is: ${otp}. Expires in 5 minutes. Never share this code.`, Charset: 'UTF-8' },
        },
      },
    }));

    this.logger.debug({ message: 'OTP email sent via SES', to: this.mask(email) });
  }

  // ── SMS — MSG91 ────────────────────────────────────────────────────────────

  private async sendSms(phone: string, otp: string): Promise<void> {
    const authKey = this.configService.get<string>('MSG91_AUTH_KEY');
    const templateId = this.configService.get<string>('MSG91_OTP_TEMPLATE_ID');

    if (!authKey || !templateId) {
      this.logger.warn({
        message: '⚠️  MSG91 not configured — OTP logged to console (dev only)',
        phone: this.mask(phone),
        otp,
      });
      return;
    }

    try {
      await axios.post('https://api.msg91.com/api/v5/otp', {
        template_id: templateId,
        mobile: phone,
        authkey: authKey,
        otp,
      });
      this.logger.debug({ message: 'OTP SMS sent via MSG91', phone: this.mask(phone) });
    } catch (err) {
      this.logger.error({ message: 'SMS OTP failed', error: (err as Error).message });
    }
  }

  // ── Email HTML template ────────────────────────────────────────────────────

  private buildOtpEmailHtml(otp: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your Decoqo account</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f4f2;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f4f2;padding:32px 16px">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:480px;width:100%">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a1a,#2d2d2d);padding:28px 32px;text-align:center">
              <h1 style="color:#c9a84c;font-size:22px;margin:0;letter-spacing:1px">Decoqo</h1>
              <p style="color:rgba(255,255,255,0.5);font-size:11px;margin:6px 0 0">India's Most Trusted Interior Execution Platform</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 32px;text-align:center">
              <h2 style="color:#1a1a1a;font-size:20px;margin:0 0 10px;font-weight:600">Your verification code</h2>
              <p style="color:#666666;font-size:14px;margin:0 0 28px;line-height:1.5">
                Use the code below to verify your account.<br>It expires in <strong>5 minutes</strong>.
              </p>
              <!-- OTP Box -->
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px">
                <tr>
                  <td style="background:#f9f7f4;border:2px dashed #c9a84c;border-radius:12px;padding:20px 48px">
                    <span style="font-size:40px;font-weight:700;letter-spacing:10px;color:#1a1a1a;font-family:'Courier New',monospace">${otp}</span>
                  </td>
                </tr>
              </table>
              <p style="color:#999999;font-size:12px;margin:0;line-height:1.6">
                Never share this code with anyone.<br>
                Decoqo will <strong>never</strong> ask for your OTP.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9f7f4;padding:16px 32px;text-align:center;border-top:1px solid #eeebe6">
              <p style="color:#bbbbbb;font-size:11px;margin:0">
                © ${new Date().getFullYear()} Decoqo. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  /** Store a password-reset grant in Redis (10 minutes TTL). */
  async storeResetGrant(key: string): Promise<void> {
    await this.redis.setex(key, 600, '1');
  }

  /** Consume (read + delete) a password-reset grant. Returns true if it existed. */
  async consumeResetGrant(key: string): Promise<boolean> {
    const val = await this.redis.get(key);
    if (!val) return false;
    await this.redis.del(key);
    return true;
  }

  private mask(identifier: string): string {
    if (identifier.includes('@')) {
      const [local, domain] = identifier.split('@');
      return `${local?.slice(0, 2)}***@${domain}`;
    }
    return `${identifier.slice(0, 3)}****${identifier.slice(-2)}`;
  }
}
