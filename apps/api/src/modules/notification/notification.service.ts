import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { PrismaService } from '../../prisma/prisma.service';
import axios from 'axios';

// ---------------------------------------------------------------------------
// Email template helpers
// ---------------------------------------------------------------------------

function emailWrapper(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:Inter,Arial,sans-serif;background:#f5f4f2;margin:0;padding:0}
  .container{max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .header{background:linear-gradient(135deg,#1a1a1a,#2d2d2d);padding:28px 32px;text-align:center}
  .header h1{color:#c9a84c;font-size:22px;margin:0;font-weight:700;letter-spacing:.5px}
  .header p{color:#ffffff80;font-size:13px;margin:6px 0 0}
  .body{padding:32px}
  .body h2{color:#1a1a1a;font-size:18px;margin:0 0 12px}
  .body p{color:#555;font-size:14px;line-height:1.6;margin:0 0 16px}
  .cta{display:inline-block;background:linear-gradient(135deg,#8b6914,#c9a84c);color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;margin:8px 0}
  .info-box{background:#f9f7f4;border-left:4px solid #c9a84c;padding:14px 18px;border-radius:0 8px 8px 0;margin:16px 0}
  .info-box p{margin:0;color:#444;font-size:13px}
  .footer{background:#f5f4f2;padding:20px 32px;text-align:center;border-top:1px solid #e8e4de}
  .footer p{color:#999;font-size:12px;margin:0}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Decoqo</h1>
    <p>India's Most Trusted Interior Execution Platform</p>
  </div>
  <div class="body">${body}</div>
  <div class="footer">
    <p>© ${new Date().getFullYear()} Decoqo Technologies Pvt. Ltd. · <a href="https://decoqo.com/legal/privacy" style="color:#c9a84c">Privacy Policy</a></p>
    <p style="margin-top:6px">This is an automated notification. Do not reply to this email.</p>
  </div>
</div>
</body>
</html>`;
}

const TEMPLATES = {
  vendorSelected: (vendorName: string, projectTitle: string, appUrl: string) => ({
    subject: `🎉 You've been selected for "${projectTitle}" — Decoqo`,
    html: emailWrapper('Vendor Selected', `
      <h2>Congratulations, ${vendorName}!</h2>
      <p>A customer has selected you for their project. Your identity has been revealed and a negotiation thread is now open.</p>
      <div class="info-box"><p><strong>Project:</strong> ${projectTitle}</p></div>
      <p>Log in to your vendor dashboard to start the negotiation and submit your detailed proposal.</p>
      <a href="${appUrl}/vendor/dashboard" class="cta">Open Negotiation →</a>
      <p style="margin-top:24px;font-size:13px;color:#888">Remember: all communication must happen within the platform. Contact details shared outside the platform will be masked.</p>
    `),
    text: `Congratulations ${vendorName}! You've been selected for "${projectTitle}". Log in to start negotiation: ${appUrl}/vendor/dashboard`,
  }),

  escrowFunded: (vendorName: string, milestoneName: string, amountInr: string, appUrl: string) => ({
    subject: `💰 Escrow funded for "${milestoneName}" — You can start work`,
    html: emailWrapper('Escrow Funded', `
      <h2>Escrow is funded, ${vendorName}!</h2>
      <p>The customer has funded the escrow for your next milestone. You can now start work.</p>
      <div class="info-box">
        <p><strong>Milestone:</strong> ${milestoneName}</p>
        <p><strong>Amount held in escrow:</strong> ${amountInr}</p>
      </div>
      <p>Start the milestone from your dashboard, complete the work, upload evidence, and submit for customer approval.</p>
      <a href="${appUrl}/vendor/dashboard" class="cta">Start Milestone →</a>
    `),
    text: `Escrow funded for "${milestoneName}" (${amountInr}). Start work now: ${appUrl}/vendor/dashboard`,
  }),

  milestoneSubmitted: (customerName: string, milestoneName: string, amountInr: string, appUrl: string) => ({
    subject: `📋 Milestone submitted for your review — "${milestoneName}"`,
    html: emailWrapper('Milestone Submitted', `
      <h2>Hi ${customerName},</h2>
      <p>Your vendor has submitted a milestone for your review. Please review the evidence and approve or request changes.</p>
      <div class="info-box">
        <p><strong>Milestone:</strong> ${milestoneName}</p>
        <p><strong>Escrow amount:</strong> ${amountInr}</p>
      </div>
      <p>You have <strong>7 days</strong> to review. If no action is taken, the milestone will be auto-approved.</p>
      <a href="${appUrl}/customer/dashboard" class="cta">Review Milestone →</a>
    `),
    text: `Milestone "${milestoneName}" submitted for review. Approve or request changes: ${appUrl}/customer/dashboard`,
  }),

  milestoneApproved: (vendorName: string, milestoneName: string, amountInr: string, appUrl: string) => ({
    subject: `✅ Payment released for "${milestoneName}" — ${amountInr}`,
    html: emailWrapper('Payment Released', `
      <h2>Payment released, ${vendorName}!</h2>
      <p>The customer has approved your milestone. The escrow funds have been released to your linked account.</p>
      <div class="info-box">
        <p><strong>Milestone:</strong> ${milestoneName}</p>
        <p><strong>Amount released:</strong> ${amountInr}</p>
      </div>
      <p>Funds will appear in your bank account within 1-2 business days via Razorpay Route.</p>
      <a href="${appUrl}/vendor/dashboard" class="cta">View Dashboard →</a>
    `),
    text: `Payment of ${amountInr} released for "${milestoneName}". View dashboard: ${appUrl}/vendor/dashboard`,
  }),

  disputeOpened: (adminEmail: string, projectTitle: string, milestoneName: string, reason: string, appUrl: string) => ({
    subject: `⚠️ Dispute raised — "${projectTitle}" · "${milestoneName}"`,
    html: emailWrapper('Dispute Raised', `
      <h2>A dispute has been raised</h2>
      <p>A dispute requires your attention and resolution within 48 hours.</p>
      <div class="info-box">
        <p><strong>Project:</strong> ${projectTitle}</p>
        <p><strong>Milestone:</strong> ${milestoneName}</p>
        <p><strong>Reason:</strong> ${reason}</p>
      </div>
      <p>The escrow funds are currently held. Review the evidence from both parties and issue a decision.</p>
      <a href="${appUrl}/admin/disputes" class="cta">Review Dispute →</a>
    `),
    text: `Dispute raised for "${projectTitle}" · "${milestoneName}". Reason: ${reason}. Review: ${appUrl}/admin/disputes`,
  }),

  disputeDecided: (recipientName: string, decision: string, reason: string, appUrl: string) => ({
    subject: `⚖️ Dispute decision issued — ${decision.replace(/_/g, ' ')}`,
    html: emailWrapper('Dispute Decision', `
      <h2>Hi ${recipientName},</h2>
      <p>The Decoqo admin team has reviewed the dispute and issued a decision.</p>
      <div class="info-box">
        <p><strong>Decision:</strong> ${decision.replace(/_/g, ' ')}</p>
        <p><strong>Reason:</strong> ${reason}</p>
      </div>
      <p>The escrow funds will be processed according to this decision within 1-2 business days.</p>
      <a href="${appUrl}/customer/dashboard" class="cta">View Project →</a>
    `),
    text: `Dispute decision: ${decision}. Reason: ${reason}. View: ${appUrl}/customer/dashboard`,
  }),

  bidReceived: (customerName: string, projectTitle: string, bidCount: number, appUrl: string) => ({
    subject: `📬 New bid received for "${projectTitle}"`,
    html: emailWrapper('New Bid Received', `
      <h2>Hi ${customerName},</h2>
      <p>A new bid has been submitted for your project. You now have <strong>${bidCount} bid${bidCount !== 1 ? 's' : ''}</strong> to review.</p>
      <div class="info-box"><p><strong>Project:</strong> ${projectTitle}</p></div>
      <p>All bids are anonymous until you select a vendor. Review the BOQ, material level, and vendor profile before deciding.</p>
      <a href="${appUrl}/customer/dashboard" class="cta">Review Bids →</a>
    `),
    text: `New bid received for "${projectTitle}". You now have ${bidCount} bid(s). Review: ${appUrl}/customer/dashboard`,
  }),

  bidShortlisted: (vendorName: string, projectTitle: string, appUrl: string) => ({
    subject: `⭐ Your bid was shortlisted for "${projectTitle}"`,
    html: emailWrapper('Bid Shortlisted', `
      <h2>Great news, ${vendorName}!</h2>
      <p>The customer has shortlisted your bid for their project. You're one step closer to being selected.</p>
      <div class="info-box"><p><strong>Project:</strong> ${projectTitle}</p></div>
      <p>Stay tuned — the customer will make their final selection soon. Make sure your profile and portfolio are up to date.</p>
      <a href="${appUrl}/vendor/bids" class="cta">View My Bids →</a>
    `),
    text: `Your bid was shortlisted for "${projectTitle}". View bids: ${appUrl}/vendor/bids`,
  }),

  otpEmail: (otp: string) => ({
    subject: `${otp} is your Decoqo verification code`,
    html: emailWrapper('Verify Your Account', `
      <h2>Your verification code</h2>
      <p>Use the code below to verify your Decoqo account. This code expires in 5 minutes.</p>
      <div style="text-align:center;margin:28px 0">
        <div style="display:inline-block;background:#f9f7f4;border:2px dashed #c9a84c;border-radius:12px;padding:20px 40px">
          <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#1a1a1a">${otp}</span>
        </div>
      </div>
      <p style="font-size:13px;color:#888">If you didn't request this code, please ignore this email. Never share this code with anyone.</p>
    `),
    text: `Your Decoqo verification code is: ${otp}. Expires in 5 minutes.`,
  }),
};

// ---------------------------------------------------------------------------
// NotificationService
// ---------------------------------------------------------------------------

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly sesClient: SESClient;
  private readonly fromEmail: string;
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.sesClient = new SESClient({
      region: configService.get<string>('aws.region', 'ap-south-1'),
      credentials: {
        accessKeyId: configService.get<string>('aws.accessKeyId', ''),
        secretAccessKey: configService.get<string>('aws.secretAccessKey', ''),
      },
    });
    this.fromEmail = configService.get<string>('aws.sesFromEmail', 'noreply@decoqo.com');
    this.appUrl = configService.get<string>('APP_URL', 'https://decoqo.com');
  }

  // ── Core send methods ──────────────────────────────────────────────────────

  async sendEmail(params: {
    to: string;
    subject: string;
    htmlBody: string;
    textBody: string;
    userId?: string;
    templateId?: string;
  }): Promise<void> {
    try {
      await this.sesClient.send(
        new SendEmailCommand({
          Source: `Decoqo <${this.fromEmail}>`,
          Destination: { ToAddresses: [params.to] },
          Message: {
            Subject: { Data: params.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: params.htmlBody, Charset: 'UTF-8' },
              Text: { Data: params.textBody, Charset: 'UTF-8' },
            },
          },
        }),
      );

      if (params.userId) {
        await this.prisma.notificationLog.create({
          data: {
            userId: params.userId,
            channel: 'EMAIL',
            templateId: params.templateId ?? 'custom',
            subject: params.subject,
            body: params.textBody,
            status: 'SENT',
            sentAt: new Date(),
          },
        });
      }

      this.logger.log({ message: 'Email sent', to: params.to, subject: params.subject });
    } catch (error) {
      this.logger.error({ message: 'Failed to send email', to: params.to, error: (error as Error).message });

      if (params.userId) {
        await this.prisma.notificationLog.create({
          data: {
            userId: params.userId,
            channel: 'EMAIL',
            templateId: params.templateId ?? 'custom',
            subject: params.subject,
            body: params.textBody,
            status: 'FAILED',
          },
        }).catch(() => { /* ignore log failure */ });
      }
    }
  }

  async sendSms(phone: string, message: string, userId?: string): Promise<void> {
    const authKey = this.configService.get<string>('MSG91_AUTH_KEY');
    if (!authKey) {
      this.logger.debug({ message: 'SMS not configured (dev mode)', phone, sms: message });
      return;
    }

    try {
      await axios.post('https://api.msg91.com/api/sendhttp.php', null, {
        params: {
          authkey: authKey,
          mobiles: phone,
          message,
          sender: this.configService.get<string>('MSG91_SENDER_ID', 'DECOQO'),
          route: '4',
        },
      });

      if (userId) {
        await this.prisma.notificationLog.create({
          data: { userId, channel: 'SMS', templateId: 'sms', body: message, status: 'SENT', sentAt: new Date() },
        });
      }
    } catch (error) {
      this.logger.error({ message: 'Failed to send SMS', phone, error: (error as Error).message });
    }
  }

  // ── Event listeners ────────────────────────────────────────────────────────

  @OnEvent('vendor.selected')
  async onVendorSelected(payload: { projectId: string; bidId: string; vendorId: string }) {
    try {
      const vendor = await this.prisma.vendorProfile.findUnique({
        where: { id: payload.vendorId },
        include: { user: { select: { email: true, phone: true } } },
      });
      const project = await this.prisma.project.findUnique({ where: { id: payload.projectId } });

      if (!vendor || !project) return;

      const tpl = TEMPLATES.vendorSelected(vendor.displayName, project.title, this.appUrl);

      if (vendor.user.email) {
        await this.sendEmail({
          to: vendor.user.email,
          subject: tpl.subject,
          htmlBody: tpl.html,
          textBody: tpl.text,
          userId: vendor.userId,
          templateId: 'vendor_selected',
        });
      }

      if (vendor.user.phone) {
        await this.sendSms(
          vendor.user.phone,
          `Decoqo: You've been selected for "${project.title}". Log in to start negotiation.`,
          vendor.userId,
        );
      }
    } catch (error) {
      this.logger.error({ message: 'Notification error: vendor.selected', error: (error as Error).message });
    }
  }

  @OnEvent('escrow.funded')
  async onEscrowFunded(payload: { escrowId: string }) {
    try {
      const escrow = await this.prisma.escrowAccount.findUnique({
        where: { id: payload.escrowId },
        include: {
          milestone: {
            include: {
              project: {
                include: {
                  selectedBid: { include: { vendor: { include: { user: { select: { email: true, phone: true } } } } } },
                },
              },
            },
          },
        },
      });

      if (!escrow?.milestone) return;

      const vendor = escrow.milestone.project.selectedBid?.vendor;
      if (!vendor) return;

      const amountInr = `₹${(escrow.amountPaise / 100).toLocaleString('en-IN')}`;
      const tpl = TEMPLATES.escrowFunded(vendor.displayName, escrow.milestone.name, amountInr, this.appUrl);

      if (vendor.user.email) {
        await this.sendEmail({
          to: vendor.user.email,
          subject: tpl.subject,
          htmlBody: tpl.html,
          textBody: tpl.text,
          userId: vendor.userId,
          templateId: 'escrow_funded',
        });
      }
    } catch (error) {
      this.logger.error({ message: 'Notification error: escrow.funded', error: (error as Error).message });
    }
  }

  @OnEvent('milestone.submitted')
  async onMilestoneSubmitted(payload: { milestoneId: string; projectId: string }) {
    try {
      const milestone = await this.prisma.milestone.findUnique({
        where: { id: payload.milestoneId },
        include: {
          project: {
            include: {
              customer: { include: { user: { select: { email: true, phone: true } } } },
            },
          },
          escrowAccount: true,
        },
      });

      if (!milestone) return;

      const customer = milestone.project.customer;
      const amountInr = milestone.escrowAccount
        ? `₹${(milestone.escrowAccount.amountPaise / 100).toLocaleString('en-IN')}`
        : 'N/A';

      const tpl = TEMPLATES.milestoneSubmitted(customer.displayName, milestone.name, amountInr, this.appUrl);

      if (customer.user.email) {
        await this.sendEmail({
          to: customer.user.email,
          subject: tpl.subject,
          htmlBody: tpl.html,
          textBody: tpl.text,
          userId: customer.userId,
          templateId: 'milestone_submitted',
        });
      }
    } catch (error) {
      this.logger.error({ message: 'Notification error: milestone.submitted', error: (error as Error).message });
    }
  }

  @OnEvent('milestone.approved')
  async onMilestoneApproved(payload: { milestoneId: string; projectId: string }) {
    try {
      const milestone = await this.prisma.milestone.findUnique({
        where: { id: payload.milestoneId },
        include: {
          project: {
            include: {
              selectedBid: { include: { vendor: { include: { user: { select: { email: true } } } } } },
            },
          },
          escrowAccount: true,
        },
      });

      if (!milestone) return;

      const vendor = milestone.project.selectedBid?.vendor;
      if (!vendor) return;

      const amountInr = milestone.escrowAccount
        ? `₹${(milestone.escrowAccount.amountPaise / 100).toLocaleString('en-IN')}`
        : 'N/A';

      const tpl = TEMPLATES.milestoneApproved(vendor.displayName, milestone.name, amountInr, this.appUrl);

      if (vendor.user.email) {
        await this.sendEmail({
          to: vendor.user.email,
          subject: tpl.subject,
          htmlBody: tpl.html,
          textBody: tpl.text,
          userId: vendor.userId,
          templateId: 'milestone_approved',
        });
      }
    } catch (error) {
      this.logger.error({ message: 'Notification error: milestone.approved', error: (error as Error).message });
    }
  }

  @OnEvent('dispute.opened')
  async onDisputeOpened(payload: { disputeId: string; projectId: string }) {
    try {
      const dispute = await this.prisma.dispute.findUnique({
        where: { id: payload.disputeId },
        include: {
          milestone: true,
          project: true,
        },
      });

      if (!dispute) return;

      // Notify all admins
      const admins = await this.prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE' },
        select: { email: true, id: true },
      });

      const tpl = TEMPLATES.disputeOpened(
        'Admin',
        dispute.project.title,
        dispute.milestone.name,
        dispute.reason,
        this.appUrl,
      );

      for (const admin of admins) {
        if (admin.email) {
          await this.sendEmail({
            to: admin.email,
            subject: tpl.subject,
            htmlBody: tpl.html,
            textBody: tpl.text,
            userId: admin.id,
            templateId: 'dispute_opened',
          });
        }
      }
    } catch (error) {
      this.logger.error({ message: 'Notification error: dispute.opened', error: (error as Error).message });
    }
  }

  @OnEvent('dispute.decided')
  async onDisputeDecided(payload: { disputeId: string; decision: string }) {
    try {
      const dispute = await this.prisma.dispute.findUnique({
        where: { id: payload.disputeId },
        include: {
          project: {
            include: {
              customer: { include: { user: { select: { email: true } } } },
              selectedBid: { include: { vendor: { include: { user: { select: { email: true } } } } } },
            },
          },
        },
      });

      if (!dispute) return;

      const reason = dispute.decisionReason ?? 'See platform for details';
      const tpl = TEMPLATES.disputeDecided('', payload.decision, reason, this.appUrl);

      // Notify customer
      const customerEmail = dispute.project.customer.user.email;
      if (customerEmail) {
        const customerTpl = TEMPLATES.disputeDecided(dispute.project.customer.displayName, payload.decision, reason, this.appUrl);
        await this.sendEmail({
          to: customerEmail,
          subject: customerTpl.subject,
          htmlBody: customerTpl.html,
          textBody: customerTpl.text,
          userId: dispute.project.customer.userId,
          templateId: 'dispute_decided',
        });
      }

      // Notify vendor
      const vendor = dispute.project.selectedBid?.vendor;
      if (vendor?.user.email) {
        const vendorTpl = TEMPLATES.disputeDecided(vendor.displayName, payload.decision, reason, this.appUrl);
        await this.sendEmail({
          to: vendor.user.email,
          subject: vendorTpl.subject,
          htmlBody: vendorTpl.html,
          textBody: vendorTpl.text,
          userId: vendor.userId,
          templateId: 'dispute_decided',
        });
      }
    } catch (error) {
      this.logger.error({ message: 'Notification error: dispute.decided', error: (error as Error).message });
    }
  }

  @OnEvent('bid.submitted')
  async onBidSubmitted(payload: { bidId: string; projectId: string }) {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: payload.projectId },
        include: {
          customer: { include: { user: { select: { email: true, phone: true } } } },
          _count: { select: { bids: true } },
        },
      });
      if (!project) return;

      const tpl = TEMPLATES.bidReceived(
        project.customer.displayName,
        project.title,
        project._count.bids,
        this.appUrl,
      );

      if (project.customer.user.email) {
        await this.sendEmail({
          to: project.customer.user.email,
          subject: tpl.subject,
          htmlBody: tpl.html,
          textBody: tpl.text,
          userId: project.customer.userId,
          templateId: 'bid_received',
        });
      }

      if (project.customer.user.phone) {
        await this.sendSms(
          project.customer.user.phone,
          `Decoqo: New bid received for "${project.title}". Review bids in your dashboard.`,
          project.customer.userId,
        );
      }
    } catch (error) {
      this.logger.error({ message: 'Notification error: bid.submitted', error: (error as Error).message });
    }
  }

  @OnEvent('bid.shortlisted')
  async onBidShortlisted(payload: { bidId: string; projectId: string }) {
    try {
      const bid = await this.prisma.bid.findUnique({
        where: { id: payload.bidId },
        include: {
          vendor: { include: { user: { select: { email: true, phone: true } } } },
          project: { select: { title: true } },
        },
      });
      if (!bid) return;

      const tpl = TEMPLATES.bidShortlisted(bid.vendor.displayName, bid.project.title, this.appUrl);

      if (bid.vendor.user.email) {
        await this.sendEmail({
          to: bid.vendor.user.email,
          subject: tpl.subject,
          htmlBody: tpl.html,
          textBody: tpl.text,
          userId: bid.vendor.userId,
          templateId: 'bid_shortlisted',
        });
      }

      if (bid.vendor.user.phone) {
        await this.sendSms(
          bid.vendor.user.phone,
          `Decoqo: Your bid for "${bid.project.title}" has been shortlisted! Check your dashboard.`,
          bid.vendor.userId,
        );
      }
    } catch (error) {
      this.logger.error({ message: 'Notification error: bid.shortlisted', error: (error as Error).message });
    }
  }

  // ── OTP email (called directly by OtpService) ──────────────────────────────
  async sendOtpEmail(email: string, otp: string, userId?: string): Promise<void> {
    const tpl = TEMPLATES.otpEmail(otp);
    await this.sendEmail({
      to: email,
      subject: tpl.subject,
      htmlBody: tpl.html,
      textBody: tpl.text,
      userId,
      templateId: 'otp_verification',
    });
  }
}
