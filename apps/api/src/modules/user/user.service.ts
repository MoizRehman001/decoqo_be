import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        emailVerified: true,
        phoneVerified: true,
        createdAt: true,
        customerProfile: true,
        vendorProfile: {
          select: {
            id: true,
            businessName: true,
            displayName: true,
            city: true,
            categories: true,
            serviceAreas: true,
            kycStatus: true,
            isApproved: true,
            averageRating: true,
            totalProjects: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, data: { displayName?: string; city?: string }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (user.role === 'CUSTOMER') {
      return this.prisma.customerProfile.update({
        where: { userId },
        data: { displayName: data.displayName, city: data.city },
      });
    }

    return this.prisma.vendorProfile.update({
      where: { userId },
      data: { displayName: data.displayName, city: data.city },
    });
  }

  async softDelete(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: `deleted_${userId}@deleted.decoqo.com`,
        phone: null,
        passwordHash: null,
        deletedAt: new Date(),
      },
    });

    await this.prisma.customerProfile.updateMany({
      where: { userId },
      data: { displayName: 'Deleted User', avatarUrl: null },
    });
  }
}
