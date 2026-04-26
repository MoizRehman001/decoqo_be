import { registerAs } from '@nestjs/config';

export default registerAs('razorpay', () => ({
  keyId: process.env['RAZORPAY_KEY_ID'] ?? '',
  keySecret: process.env['RAZORPAY_KEY_SECRET'] ?? '',
  webhookSecret: process.env['RAZORPAY_WEBHOOK_SECRET'] ?? '',
}));
