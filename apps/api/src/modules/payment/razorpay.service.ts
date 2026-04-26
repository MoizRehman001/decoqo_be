import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Razorpay from 'razorpay';
import * as crypto from 'crypto';

@Injectable()
export class RazorpayService {
  private readonly client: Razorpay;
  private readonly logger = new Logger(RazorpayService.name);

  constructor(private readonly configService: ConfigService) {
    this.client = new Razorpay({
      key_id: configService.getOrThrow<string>('razorpay.keyId'),
      key_secret: configService.getOrThrow<string>('razorpay.keySecret'),
    });
  }

  async createOrder(params: {
    amountPaise: number;
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
  }) {
    return this.client.orders.create({
      amount: params.amountPaise,
      currency: params.currency,
      receipt: params.receipt,
      notes: params.notes,
    });
  }

  async getOrder(orderId: string) {
    return this.client.orders.fetch(orderId);
  }

  async transferToVendor(params: {
    orderId: string;
    vendorLinkedAccountId: string;
    amountPaise: number;
    currency?: string;
  }) {
    return this.client.transfers.create({
      account: params.vendorLinkedAccountId,
      amount: params.amountPaise,
      currency: params.currency ?? 'INR',
      notes: { orderId: params.orderId },
    });
  }

  async refundPayment(params: {
    paymentId: string;
    amountPaise: number;
    notes?: Record<string, string>;
  }) {
    return this.client.payments.refund(params.paymentId, {
      amount: params.amountPaise,
      notes: params.notes,
    });
  }

  async createLinkedAccount(vendor: {
    businessName: string;
    displayName: string;
    email: string;
    phone: string;
    panNumber: string;
  }) {
    return this.client.accounts.create({
      email: vendor.email,
      phone: vendor.phone,
      contact_name: vendor.displayName,
      legal_business_name: vendor.businessName,
      business_type: 'individual',
      profile: {
        category: 'home_and_furniture',
        subcategory: 'furniture',
        addresses: {
          registered: {
            street1: 'India',
            street2: '',
            city: 'Bengaluru',
            state: 'Karnataka',
            postal_code: '560001',
            country: 'IN',
          },
        },
      },
      legal_info: { pan: vendor.panNumber },
    });
  }

  /**
   * Verify Razorpay webhook signature using constant-time comparison.
   */
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = this.configService.getOrThrow<string>('razorpay.webhookSecret');
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex'),
      );
    } catch {
      return false;
    }
  }
}
