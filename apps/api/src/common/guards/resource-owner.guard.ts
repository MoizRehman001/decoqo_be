import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../decorators/current-user.decorator';

/**
 * ResourceOwnerGuard — validates that the authenticated user owns the project
 * referenced in the route params (:projectId or :id on project routes).
 *
 * Rules:
 * - CUSTOMER: must own the project (customerId matches)
 * - VENDOR: must be the selected vendor for the project
 * - ADMIN / SUPER_ADMIN: always allowed
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, ResourceOwnerGuard)
 *   @Get('projects/:projectId/milestones')
 */
@Injectable()
export class ResourceOwnerGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user: JwtPayload;
      params: Record<string, string>;
    }>();

    const user = request.user;
    if (!user) throw new ForbiddenException();

    // Admins bypass all resource checks
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return true;

    // Extract projectId from route params
    const projectId = request.params['projectId'] ?? request.params['id'];
    if (!projectId) return true; // No project param — guard is a no-op

    const project = await this.prisma.project.findUnique({
      where: { id: projectId, deletedAt: null },
      select: {
        customerId: true,
        selectedBidId: true,
        selectedBid: { select: { vendorId: true } },
      },
    });

    if (!project) throw new NotFoundException('Project not found');

    if (user.role === 'CUSTOMER') {
      const customer = await this.prisma.customerProfile.findUnique({
        where: { userId: user.sub },
        select: { id: true },
      });
      if (!customer || customer.id !== project.customerId) {
        throw new ForbiddenException('You do not have access to this project');
      }
      return true;
    }

    if (user.role === 'VENDOR') {
      if (!project.selectedBidId || !project.selectedBid) {
        throw new ForbiddenException('No vendor has been selected for this project');
      }
      const vendor = await this.prisma.vendorProfile.findUnique({
        where: { userId: user.sub },
        select: { id: true },
      });
      if (!vendor || vendor.id !== project.selectedBid.vendorId) {
        throw new ForbiddenException('You are not the selected vendor for this project');
      }
      return true;
    }

    throw new ForbiddenException();
  }
}
