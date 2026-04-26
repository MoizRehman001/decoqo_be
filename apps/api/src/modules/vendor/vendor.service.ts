import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class VendorService {
  private readonly logger = new Logger(VendorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getProfile(userId: string) {
    return this.prisma.vendorProfile.findUniqueOrThrow({
      where: { userId },
      include: { kyc: true },
    });
  }

  async updateProfile(userId: string, data: {
    bio?: string;
    serviceAreas?: string[];
    categories?: string[];
    websiteUrl?: string;
  }) {
    return this.prisma.vendorProfile.update({ where: { userId }, data });
  }

  async submitKyc(userId: string, data: {
    panNumber: string;
    bankAccountNumber: string;
    bankIfsc: string;
    businessProofUrl?: string;
  }) {
    const vendor = await this.prisma.vendorProfile.findUniqueOrThrow({ where: { userId } });

    // Verify PAN via Surepass
    const panValid = await this.verifyPan(data.panNumber);
    if (!panValid) throw new BadRequestException('PAN verification failed');

    // Verify bank account
    const bankValid = await this.verifyBankAccount(data.bankAccountNumber, data.bankIfsc, vendor.displayName);

    await this.prisma.vendorKyc.upsert({
      where: { vendorId: vendor.id },
      create: {
        vendorId: vendor.id,
        panNumber: data.panNumber,
        panVerified: panValid,
        panVerifiedAt: panValid ? new Date() : null,
        bankAccountNumber: data.bankAccountNumber,
        bankIfsc: data.bankIfsc,
        bankVerified: bankValid,
        bankVerifiedAt: bankValid ? new Date() : null,
        businessProofUrl: data.businessProofUrl,
        kycStatus: 'PENDING',
      },
      update: {
        panNumber: data.panNumber,
        panVerified: panValid,
        bankAccountNumber: data.bankAccountNumber,
        bankIfsc: data.bankIfsc,
        bankVerified: bankValid,
        kycStatus: 'PENDING',
      },
    });

    await this.prisma.vendorProfile.update({
      where: { id: vendor.id },
      data: { kycStatus: 'PENDING' },
    });

    return { submitted: true, panVerified: panValid, bankVerified: bankValid };
  }

  async getKycStatus(userId: string) {
    const vendor = await this.prisma.vendorProfile.findUniqueOrThrow({
      where: { userId },
      select: { kycStatus: true, isApproved: true, kyc: true },
    });
    return vendor;
  }

  async addPortfolioItem(userId: string, fileUrl: string) {
    const vendor = await this.prisma.vendorProfile.findUniqueOrThrow({ where: { userId } });
    return this.prisma.vendorProfile.update({
      where: { id: vendor.id },
      data: { portfolioUrls: { push: fileUrl } },
    });
  }

  async removePortfolioItem(userId: string, fileUrl: string) {
    const vendor = await this.prisma.vendorProfile.findUniqueOrThrow({ where: { userId } });
    const updated = vendor.portfolioUrls.filter((url) => url !== fileUrl);
    return this.prisma.vendorProfile.update({
      where: { id: vendor.id },
      data: { portfolioUrls: updated },
    });
  }

  async getPublicProfile(vendorId: string) {
    return this.prisma.vendorProfile.findUniqueOrThrow({
      where: { id: vendorId },
      select: {
        id: true,
        businessName: true,
        displayName: true,
        city: true,
        categories: true,
        serviceAreas: true,
        portfolioUrls: true,
        bio: true,
        averageRating: true,
        totalProjects: true,
        kycStatus: true,
        isApproved: true,
        // NEVER include: userId, phone, email, bankAccount, panNumber
      },
    });
  }

  private async verifyPan(panNumber: string): Promise<boolean> {
    const apiKey = this.configService.get<string>('SUREPASS_API_KEY');
    if (!apiKey) {
      this.logger.warn('Surepass not configured — skipping PAN verification (dev mode)');
      return true;
    }

    try {
      const response = await axios.post(
        'https://kyc-api.surepass.io/api/v1/pan/pan',
        { id_number: panNumber },
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      return response.data?.data?.status === 'id_found';
    } catch {
      return false;
    }
  }

  private async verifyBankAccount(accountNumber: string, ifsc: string, name: string): Promise<boolean> {
    const apiKey = this.configService.get<string>('SUREPASS_API_KEY');
    if (!apiKey) return true;

    try {
      const response = await axios.post(
        'https://kyc-api.surepass.io/api/v1/bank-verification',
        { id_number: accountNumber, ifsc, name },
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      return response.data?.data?.account_exists === true;
    } catch {
      return false;
    }
  }
}
