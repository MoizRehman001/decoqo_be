import {
  Injectable, Logger, NotFoundException, BadRequestException,
  OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCommissionPolicyDto,
  UpdateCommissionPolicyDto,
  SetPriorityDto,
  ToggleActiveDto,
} from './dto/commission-policy.dto';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Extended condition types
// ---------------------------------------------------------------------------

export interface ExtendedPolicyConditions {
  projectCountLessThan?: number;
  projectCountGreaterThan?: number;
  amountLessThan?: number;
  amountGreaterThan?: number;
  startDate?: string;
  endDate?: string;
  // New condition types
  projectCountRange?: { min: number; max: number };
  ratingAbove?: { rating: number };
  gmvAbove?: { gmvPaise: number };
  daysSinceJoined?: { days: number };
}

export interface VendorOverride {
  id: string;
  vendorId: string;
  vendorName: string;
  vendorEmail: string | null;
  commissionPercent: number;
  reason: string;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommissionApplication {
  id: string;
  projectId: string;
  vendorId: string;
  vendorName: string | null;
  policyId: string | null;
  policyName: string | null;
  commissionPercent: number;
  commissionAmountPaise: number;
  isFallback: boolean;
  appliedAt: string;
}

export interface VendorCommissionSummary {
  vendorId: string;
  currentPolicy: {
    id: string | null;
    name: string | null;
    commissionPercent: number;
    isFallback: boolean;
    isOverride: boolean;
  };
  totalCommissionPaidPaise: number;
  projectsCompleted: number;
  projectsRemainingBeforeCommission: number | null;
  nextPolicy: {
    id: string | null;
    name: string | null;
    commissionPercent: number;
  } | null;
  override: VendorOverride | null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GetCommissionParams {
  designerId: string;
  projectAmountPaise: number;
  cityId?: string;
  stateId?: string;
}

export interface CommissionResult {
  commissionPercent: number;
  platformFeePercent: number;
  matchedPolicyId: string | null;
  matchedPolicyName: string | null;
  isFallback: boolean;
}

type PolicyConditions = ExtendedPolicyConditions;

interface PolicyActions {
  commissionPercent: number;
  platformFeePercent?: number;
}

export interface RawPolicy {
  id: string;
  name: string;
  description: string | null;
  type: string;
  priority: number;
  isActive: boolean;
  conditions: PolicyConditions;
  actions: PolicyActions;
  applicableDesignerIds: string[];
  applicableCities: string[];
  applicableStates: string[];
  createdBy: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Simple in-process TTL cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return undefined; }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  del(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}

const ACTIVE_POLICIES_CACHE_KEY = 'commission:active_policies';
const CACHE_TTL_MS = 60_000;

// ---------------------------------------------------------------------------
// Raw SQL helpers — bypasses Prisma generated client entirely
// Works even when `prisma generate` hasn't been re-run after schema changes
// ---------------------------------------------------------------------------

function parsePolicy(row: Record<string, unknown>): RawPolicy {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    description: row['description'] as string | null,
    type: row['type'] as string,
    priority: Number(row['priority']),
    isActive: Boolean(row['isActive']),
    conditions: (typeof row['conditions'] === 'string'
      ? JSON.parse(row['conditions'])
      : row['conditions']) as PolicyConditions,
    actions: (typeof row['actions'] === 'string'
      ? JSON.parse(row['actions'])
      : row['actions']) as PolicyActions,
    applicableDesignerIds: (typeof row['applicableDesignerIds'] === 'string'
      ? JSON.parse(row['applicableDesignerIds'])
      : row['applicableDesignerIds'] ?? []) as string[],
    applicableCities: (typeof row['applicableCities'] === 'string'
      ? JSON.parse(row['applicableCities'])
      : row['applicableCities'] ?? []) as string[],
    applicableStates: (typeof row['applicableStates'] === 'string'
      ? JSON.parse(row['applicableStates'])
      : row['applicableStates'] ?? []) as string[],
    createdBy: row['createdBy'] as string,
    updatedBy: row['updatedBy'] as string | null,
    createdAt: new Date(row['createdAt'] as string),
    updatedAt: new Date(row['updatedAt'] as string),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class CommissionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommissionService.name);
  private readonly cache = new TtlCache<RawPolicy[]>();

  constructor(private readonly prisma: PrismaService) {}

  // ── Auto-migrate: create tables if they don't exist ───────────────────────

  async onModuleInit() {
    try {
      await this.prisma.$executeRawUnsafe(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionPolicyType') THEN
            CREATE TYPE "CommissionPolicyType" AS ENUM ('PROJECT_COUNT','TIME_RANGE','AMOUNT_RANGE','CUSTOM_OVERRIDE');
          END IF;
        END $$;
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS commission_policies (
          id TEXT NOT NULL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          type "CommissionPolicyType" NOT NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          "isActive" BOOLEAN NOT NULL DEFAULT true,
          conditions JSONB NOT NULL DEFAULT '{}',
          actions JSONB NOT NULL DEFAULT '{}',
          "applicableDesignerIds" JSONB NOT NULL DEFAULT '[]',
          "applicableCities" JSONB NOT NULL DEFAULT '[]',
          "applicableStates" JSONB NOT NULL DEFAULT '[]',
          "createdBy" TEXT NOT NULL,
          "updatedBy" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS designer_stats (
          id TEXT NOT NULL PRIMARY KEY,
          "designerId" TEXT NOT NULL UNIQUE,
          "totalProjects" INTEGER NOT NULL DEFAULT 0,
          "totalGmvPaise" BIGINT NOT NULL DEFAULT 0,
          rating DOUBLE PRECISION,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS boq_pdf_settings (
          id TEXT NOT NULL PRIMARY KEY,
          "watermarkText" TEXT NOT NULL DEFAULT 'DECOQO CONFIDENTIAL',
          "watermarkOpacity" DOUBLE PRECISION NOT NULL DEFAULT 0.08,
          "watermarkAngle" INTEGER NOT NULL DEFAULT -45,
          "showClientName" BOOLEAN NOT NULL DEFAULT true,
          "showTimestamp" BOOLEAN NOT NULL DEFAULT true,
          "isActive" BOOLEAN NOT NULL DEFAULT true,
          "updatedBy" TEXT,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Seed default BOQ PDF settings if none exist
      await this.prisma.$executeRawUnsafe(`
        INSERT INTO boq_pdf_settings (id, "updatedAt")
        SELECT gen_random_uuid()::text, NOW()
        WHERE NOT EXISTS (SELECT 1 FROM boq_pdf_settings LIMIT 1)
      `);

      // Per-vendor commission overrides table
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS vendor_commission_overrides (
          id TEXT NOT NULL PRIMARY KEY,
          "vendorId" TEXT NOT NULL UNIQUE,
          "commissionPercent" DOUBLE PRECISION NOT NULL,
          reason TEXT NOT NULL,
          "expiresAt" TIMESTAMP(3),
          "createdBy" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Commission applications history table
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS commission_applications (
          id TEXT NOT NULL PRIMARY KEY,
          "projectId" TEXT NOT NULL,
          "vendorId" TEXT NOT NULL,
          "policyId" TEXT,
          "policyName" TEXT,
          "commissionPercent" DOUBLE PRECISION NOT NULL,
          "commissionAmountPaise" BIGINT NOT NULL DEFAULT 0,
          "isFallback" BOOLEAN NOT NULL DEFAULT false,
          "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.logger.log('Commission tables ensured');
    } catch (err) {
      this.logger.error({ message: 'Failed to ensure commission tables', error: (err as Error).message });
    }
  }

  onModuleDestroy() { this.cache.clear(); }

  // ── Core Engine ────────────────────────────────────────────────────────────

  async getCommission(params: GetCommissionParams): Promise<CommissionResult> {
    // 1. Check per-vendor override first (highest priority)
    const overrideRows = await this.prisma.$queryRaw<Array<{
      id: string; commissionPercent: number; expiresAt: Date | null;
    }>>`
      SELECT id, "commissionPercent", "expiresAt"
      FROM vendor_commission_overrides
      WHERE "vendorId" = ${params.designerId}
      LIMIT 1
    `.catch(() => []);

    if (overrideRows.length > 0 && overrideRows[0]) {
      const ov = overrideRows[0];
      const isExpired = ov.expiresAt && new Date() > new Date(ov.expiresAt);
      if (!isExpired) {
        return {
          commissionPercent: ov.commissionPercent,
          platformFeePercent: 2,
          matchedPolicyId: null,
          matchedPolicyName: 'Vendor Override',
          isFallback: false,
        };
      }
    }

    const policies = await this.getActivePoliciesCached();

    // Fetch designer stats via raw SQL
    const statsRows = await this.prisma.$queryRaw<Array<{
      totalProjects: number; totalGmvPaise: bigint; rating: number | null; createdAt: Date | null;
    }>>`
      SELECT ds."totalProjects", ds."totalGmvPaise", ds.rating, vp."createdAt"
      FROM designer_stats ds
      LEFT JOIN "VendorProfile" vp ON vp.id = ds."designerId"
      WHERE ds."designerId" = ${params.designerId}
      LIMIT 1
    `.catch(() => []);

    const totalProjects = statsRows[0]?.totalProjects ?? 0;
    const totalGmvPaise = Number(statsRows[0]?.totalGmvPaise ?? 0);
    const rating = statsRows[0]?.rating ?? null;
    const joinedAt = statsRows[0]?.createdAt ?? null;
    const now = new Date();

    for (const policy of policies) {
      const designerIds = policy.applicableDesignerIds;
      if (designerIds.length > 0 && !designerIds.includes(params.designerId)) continue;

      const cities = policy.applicableCities;
      if (cities.length > 0 && params.cityId && !cities.includes(params.cityId)) continue;

      const states = policy.applicableStates;
      if (states.length > 0 && params.stateId && !states.includes(params.stateId)) continue;

      const conditions = policy.conditions;
      let conditionsMet = true;

      // Legacy conditions
      if (conditions.projectCountLessThan !== undefined && totalProjects >= conditions.projectCountLessThan) conditionsMet = false;
      if (conditions.projectCountGreaterThan !== undefined && totalProjects <= conditions.projectCountGreaterThan) conditionsMet = false;
      if (conditions.amountLessThan !== undefined && params.projectAmountPaise >= conditions.amountLessThan) conditionsMet = false;
      if (conditions.amountGreaterThan !== undefined && params.projectAmountPaise <= conditions.amountGreaterThan) conditionsMet = false;
      if (conditions.startDate && now < new Date(conditions.startDate)) conditionsMet = false;
      if (conditions.endDate && now > new Date(conditions.endDate)) conditionsMet = false;

      // New condition types
      if (conditions.projectCountRange) {
        const { min, max } = conditions.projectCountRange;
        if (totalProjects < min || totalProjects > max) conditionsMet = false;
      }
      if (conditions.ratingAbove) {
        if (rating === null || rating < conditions.ratingAbove.rating) conditionsMet = false;
      }
      if (conditions.gmvAbove) {
        if (totalGmvPaise < conditions.gmvAbove.gmvPaise) conditionsMet = false;
      }
      if (conditions.daysSinceJoined) {
        if (!joinedAt) {
          conditionsMet = false;
        } else {
          const daysSince = Math.floor((now.getTime() - new Date(joinedAt).getTime()) / 86_400_000);
          if (daysSince > conditions.daysSinceJoined.days) conditionsMet = false;
        }
      }

      if (!conditionsMet) continue;

      this.logger.debug({ message: 'Commission policy matched', policyId: policy.id, policyName: policy.name });

      return {
        commissionPercent: policy.actions.commissionPercent,
        platformFeePercent: policy.actions.platformFeePercent ?? 2,
        matchedPolicyId: policy.id,
        matchedPolicyName: policy.name,
        isFallback: false,
      };
    }

    return { commissionPercent: 10, platformFeePercent: 2, matchedPolicyId: null, matchedPolicyName: null, isFallback: true };
  }

  // ── Admin CRUD (all via $queryRaw / $executeRaw) ───────────────────────────

  async createPolicy(dto: CreateCommissionPolicyDto, adminId: string) {
    this.validateConditions(dto.conditions);
    this.validateActions(dto.actions);

    const id = uuidv4();
    const now = new Date();
    const conditions = JSON.stringify(dto.conditions);
    const actions = JSON.stringify(dto.actions);
    const designerIds = JSON.stringify(dto.applicableDesignerIds ?? []);
    const cities = JSON.stringify(dto.applicableCities ?? []);
    const states = JSON.stringify(dto.applicableStates ?? []);

    await this.prisma.$executeRaw`
      INSERT INTO commission_policies
        (id, name, description, type, priority, "isActive", conditions, actions,
         "applicableDesignerIds", "applicableCities", "applicableStates",
         "createdBy", "createdAt", "updatedAt")
      VALUES
        (${id}, ${dto.name}, ${dto.description ?? null}, ${dto.type}::"CommissionPolicyType",
         ${dto.priority}, true, ${conditions}::jsonb, ${actions}::jsonb,
         ${designerIds}::jsonb, ${cities}::jsonb, ${states}::jsonb,
         ${adminId}, ${now}, ${now})
    `;

    this.cache.del(ACTIVE_POLICIES_CACHE_KEY);
    this.logger.log({ message: 'Commission policy created', policyId: id, adminId });
    return this.getPolicy(id);
  }

  async updatePolicy(id: string, dto: UpdateCommissionPolicyDto, adminId: string) {
    await this.assertPolicyExists(id);
    if (dto.conditions) this.validateConditions(dto.conditions);
    if (dto.actions) this.validateActions(dto.actions);

    const now = new Date();
    // Build SET clauses dynamically
    const sets: string[] = ['"updatedBy" = \'' + adminId + '\'', '"updatedAt" = \'' + now.toISOString() + '\''];
    if (dto.name) sets.push(`name = '${dto.name.replace(/'/g, "''")}'`);
    if (dto.description !== undefined) sets.push(`description = ${dto.description ? `'${dto.description.replace(/'/g, "''")}'` : 'NULL'}`);
    if (dto.type) sets.push(`type = '${dto.type}'::"CommissionPolicyType"`);
    if (dto.priority !== undefined) sets.push(`priority = ${dto.priority}`);
    if (dto.conditions) sets.push(`conditions = '${JSON.stringify(dto.conditions)}'::jsonb`);
    if (dto.actions) sets.push(`actions = '${JSON.stringify(dto.actions)}'::jsonb`);
    if (dto.applicableDesignerIds) sets.push(`"applicableDesignerIds" = '${JSON.stringify(dto.applicableDesignerIds)}'::jsonb`);
    if (dto.applicableCities) sets.push(`"applicableCities" = '${JSON.stringify(dto.applicableCities)}'::jsonb`);
    if (dto.applicableStates) sets.push(`"applicableStates" = '${JSON.stringify(dto.applicableStates)}'::jsonb`);

    await this.prisma.$executeRawUnsafe(
      `UPDATE commission_policies SET ${sets.join(', ')} WHERE id = '${id}'`,
    );

    this.cache.del(ACTIVE_POLICIES_CACHE_KEY);
    return this.getPolicy(id);
  }

  async setPriority(id: string, dto: SetPriorityDto, adminId: string) {
    await this.assertPolicyExists(id);
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE commission_policies
      SET priority = ${dto.priority}, "updatedBy" = ${adminId}, "updatedAt" = ${now}
      WHERE id = ${id}
    `;
    this.cache.del(ACTIVE_POLICIES_CACHE_KEY);
    return this.getPolicy(id);
  }

  async toggleActive(id: string, dto: ToggleActiveDto, adminId: string) {
    await this.assertPolicyExists(id);
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE commission_policies
      SET "isActive" = ${dto.isActive}, "updatedBy" = ${adminId}, "updatedAt" = ${now}
      WHERE id = ${id}
    `;
    this.cache.del(ACTIVE_POLICIES_CACHE_KEY);
    return this.getPolicy(id);
  }

  async deletePolicy(id: string, adminId: string) {
    await this.assertPolicyExists(id);
    await this.prisma.$executeRaw`DELETE FROM commission_policies WHERE id = ${id}`;
    this.cache.del(ACTIVE_POLICIES_CACHE_KEY);
    this.logger.log({ message: 'Commission policy deleted', policyId: id, adminId });
    return { deleted: true };
  }

  async listPolicies(pagination: PaginationDto, type?: string, isActive?: boolean) {
    const conditions: string[] = [];
    if (type) conditions.push(`type = '${type}'::"CommissionPolicyType"`);
    if (isActive !== undefined) conditions.push(`"isActive" = ${isActive}`);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM commission_policies ${where} ORDER BY priority DESC, "createdAt" DESC LIMIT ${pagination.limit} OFFSET ${pagination.skip}`,
      ),
      this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM commission_policies ${where}`,
      ),
    ]);

    const items = rows.map(parsePolicy);
    const total = Number(countRows[0]?.count ?? 0);
    return paginate(items, total, pagination);
  }

  async getPolicy(id: string): Promise<RawPolicy> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT * FROM commission_policies WHERE id = ${id} LIMIT 1
    `;
    if (!rows.length || !rows[0]) throw new NotFoundException(`Commission policy ${id} not found`);
    return parsePolicy(rows[0]);
  }

  // ── Designer Stats ─────────────────────────────────────────────────────────

  async upsertDesignerStats(designerId: string, data: {
    totalProjects?: number;
    totalGmvPaise?: bigint;
    rating?: number;
  }) {
    const id = uuidv4();
    const now = new Date();
    await this.prisma.$executeRaw`
      INSERT INTO designer_stats (id, "designerId", "totalProjects", "totalGmvPaise", rating, "updatedAt")
      VALUES (${id}, ${designerId}, ${data.totalProjects ?? 0}, ${data.totalGmvPaise ?? BigInt(0)}, ${data.rating ?? null}, ${now})
      ON CONFLICT ("designerId") DO UPDATE SET
        "totalProjects" = EXCLUDED."totalProjects",
        "totalGmvPaise" = EXCLUDED."totalGmvPaise",
        rating = EXCLUDED.rating,
        "updatedAt" = EXCLUDED."updatedAt"
    `;
    return { designerId, ...data };
  }

  async searchDesigners(q?: string, limit = 20) {
    const where = q?.trim()
      ? {
          OR: [
            { displayName: { contains: q, mode: 'insensitive' as const } },
            { businessName: { contains: q, mode: 'insensitive' as const } },
            { city: { contains: q, mode: 'insensitive' as const } },
            { user: { email: { contains: q, mode: 'insensitive' as const } } },
            { user: { phone: { contains: q } } },
          ],
        }
      : {};

    const vendors = await this.prisma.vendorProfile.findMany({
      where,
      select: {
        id: true,
        displayName: true,
        businessName: true,
        city: true,
        kycStatus: true,
        isApproved: true,
        user: { select: { email: true, phone: true } },
      },
      orderBy: { displayName: 'asc' },
      take: Math.min(limit, 50),
    });

    return vendors.map((v) => ({
      id: v.id,
      displayName: v.displayName,
      businessName: v.businessName,
      city: v.city,
      email: v.user.email,
      phone: v.user.phone,
      kycStatus: v.kycStatus,
      isApproved: v.isApproved,
    }));
  }

  // ── Vendor Overrides ──────────────────────────────────────────────────────

  async setVendorOverride(
    vendorId: string,
    dto: { commissionPercent: number; reason: string; expiresAt?: string },
    adminId: string,
  ): Promise<VendorOverride> {
    if (dto.commissionPercent < 0 || dto.commissionPercent > 100) {
      throw new BadRequestException('commissionPercent must be between 0 and 100');
    }
    const id = uuidv4();
    const now = new Date();
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;

    await this.prisma.$executeRaw`
      INSERT INTO vendor_commission_overrides
        (id, "vendorId", "commissionPercent", reason, "expiresAt", "createdBy", "createdAt", "updatedAt")
      VALUES
        (${id}, ${vendorId}, ${dto.commissionPercent}, ${dto.reason}, ${expiresAt}, ${adminId}, ${now}, ${now})
      ON CONFLICT ("vendorId") DO UPDATE SET
        "commissionPercent" = EXCLUDED."commissionPercent",
        reason = EXCLUDED.reason,
        "expiresAt" = EXCLUDED."expiresAt",
        "updatedAt" = EXCLUDED."updatedAt"
    `;

    this.logger.log({ message: 'Vendor commission override set', vendorId, adminId });
    return this.getVendorOverride(vendorId);
  }

  async getVendorOverride(vendorId: string): Promise<VendorOverride> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT vco.*, vp."displayName" as "vendorName", u.email as "vendorEmail"
      FROM vendor_commission_overrides vco
      LEFT JOIN "VendorProfile" vp ON vp.id = vco."vendorId"
      LEFT JOIN "User" u ON u.id = vp."userId"
      WHERE vco."vendorId" = ${vendorId}
      LIMIT 1
    `.catch(() => []);

    if (!rows.length || !rows[0]) throw new NotFoundException(`No override found for vendor ${vendorId}`);
    return this.parseOverride(rows[0]);
  }

  async removeVendorOverride(vendorId: string, adminId: string): Promise<{ deleted: boolean }> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM vendor_commission_overrides WHERE "vendorId" = ${vendorId} LIMIT 1
    `;
    if (!rows.length) throw new NotFoundException(`No override found for vendor ${vendorId}`);
    await this.prisma.$executeRaw`DELETE FROM vendor_commission_overrides WHERE "vendorId" = ${vendorId}`;
    this.logger.log({ message: 'Vendor commission override removed', vendorId, adminId });
    return { deleted: true };
  }

  async listVendorOverrides(): Promise<VendorOverride[]> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT vco.*, vp."displayName" as "vendorName", u.email as "vendorEmail"
      FROM vendor_commission_overrides vco
      LEFT JOIN "VendorProfile" vp ON vp.id = vco."vendorId"
      LEFT JOIN "User" u ON u.id = vp."userId"
      ORDER BY vco."createdAt" DESC
    `.catch(() => []);
    return rows.map((r) => this.parseOverride(r));
  }

  private parseOverride(row: Record<string, unknown>): VendorOverride {
    return {
      id: row['id'] as string,
      vendorId: row['vendorId'] as string,
      vendorName: (row['vendorName'] as string | null) ?? 'Unknown',
      vendorEmail: row['vendorEmail'] as string | null,
      commissionPercent: Number(row['commissionPercent']),
      reason: row['reason'] as string,
      expiresAt: row['expiresAt'] ? new Date(row['expiresAt'] as string).toISOString() : null,
      createdBy: row['createdBy'] as string,
      createdAt: new Date(row['createdAt'] as string).toISOString(),
      updatedAt: new Date(row['updatedAt'] as string).toISOString(),
    };
  }

  // ── Commission History ─────────────────────────────────────────────────────

  async recordCommissionApplication(
    projectId: string,
    vendorId: string,
    result: CommissionResult & { commissionAmountPaise: number },
  ): Promise<void> {
    const id = uuidv4();
    const now = new Date();
    await this.prisma.$executeRaw`
      INSERT INTO commission_applications
        (id, "projectId", "vendorId", "policyId", "policyName", "commissionPercent",
         "commissionAmountPaise", "isFallback", "appliedAt")
      VALUES
        (${id}, ${projectId}, ${vendorId}, ${result.matchedPolicyId},
         ${result.matchedPolicyName}, ${result.commissionPercent},
         ${result.commissionAmountPaise}, ${result.isFallback}, ${now})
    `.catch((err: Error) => {
      this.logger.error({ message: 'Failed to record commission application', error: err.message });
    });
  }

  async listCommissionApplications(pagination: PaginationDto, vendorSearch?: string) {
    const searchClause = vendorSearch?.trim()
      ? `WHERE vp."displayName" ILIKE '%${vendorSearch.replace(/'/g, "''")}%'`
      : '';

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT ca.*, vp."displayName" as "vendorName"
         FROM commission_applications ca
         LEFT JOIN "VendorProfile" vp ON vp.id = ca."vendorId"
         ${searchClause}
         ORDER BY ca."appliedAt" DESC
         LIMIT ${pagination.limit} OFFSET ${pagination.skip}`,
      ),
      this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count
         FROM commission_applications ca
         LEFT JOIN "VendorProfile" vp ON vp.id = ca."vendorId"
         ${searchClause}`,
      ),
    ]).catch(() => [[], [{ count: BigInt(0) }]] as [Array<Record<string, unknown>>, Array<{ count: bigint }>]);

    const items = (rows as Array<Record<string, unknown>>).map((r) => ({
      id: r['id'] as string,
      projectId: r['projectId'] as string,
      vendorId: r['vendorId'] as string,
      vendorName: (r['vendorName'] as string | null) ?? null,
      policyId: r['policyId'] as string | null,
      policyName: r['policyName'] as string | null,
      commissionPercent: Number(r['commissionPercent']),
      commissionAmountPaise: Number(r['commissionAmountPaise']),
      isFallback: Boolean(r['isFallback']),
      appliedAt: new Date(r['appliedAt'] as string).toISOString(),
    }));

    const total = Number((countRows as Array<{ count: bigint }>)[0]?.count ?? 0);
    return paginate(items, total, pagination);
  }

  // ── Vendor Commission Summary ──────────────────────────────────────────────

  async getVendorCommissionSummary(vendorId: string): Promise<VendorCommissionSummary> {
    // Get current commission result (simulated with 0 amount)
    const currentResult = await this.getCommission({ designerId: vendorId, projectAmountPaise: 0 });

    // Get override if any
    const overrideRows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT vco.*, vp."displayName" as "vendorName", u.email as "vendorEmail"
      FROM vendor_commission_overrides vco
      LEFT JOIN "VendorProfile" vp ON vp.id = vco."vendorId"
      LEFT JOIN "User" u ON u.id = vp."userId"
      WHERE vco."vendorId" = ${vendorId}
      LIMIT 1
    `.catch(() => []);
    const override = overrideRows.length > 0 && overrideRows[0]
      ? this.parseOverride(overrideRows[0])
      : null;

    // Get total commission paid
    const paidRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COALESCE(SUM("commissionAmountPaise"), 0) as total
      FROM commission_applications
      WHERE "vendorId" = ${vendorId}
    `.catch(() => [{ total: BigInt(0) }]);
    const totalCommissionPaidPaise = Number(paidRows[0]?.total ?? 0);

    // Get projects completed
    const statsRows = await this.prisma.$queryRaw<Array<{ totalProjects: number }>>`
      SELECT "totalProjects" FROM designer_stats WHERE "designerId" = ${vendorId} LIMIT 1
    `.catch(() => []);
    const projectsCompleted = statsRows[0]?.totalProjects ?? 0;

    // Calculate projects remaining before commission kicks in
    let projectsRemainingBeforeCommission: number | null = null;
    const policies = await this.getActivePoliciesCached();
    for (const policy of policies) {
      const designerIds = policy.applicableDesignerIds;
      if (designerIds.length > 0 && !designerIds.includes(vendorId)) continue;
      const c = policy.conditions;
      if (c.projectCountLessThan !== undefined && policy.actions.commissionPercent === 0) {
        const remaining = c.projectCountLessThan - projectsCompleted;
        if (remaining > 0) {
          projectsRemainingBeforeCommission = remaining;
          break;
        }
      }
      if (c.projectCountRange && policy.actions.commissionPercent === 0) {
        const remaining = c.projectCountRange.max - projectsCompleted;
        if (remaining > 0) {
          projectsRemainingBeforeCommission = remaining;
          break;
        }
      }
    }

    // Find next policy (the one that will apply after current free period)
    let nextPolicy: VendorCommissionSummary['nextPolicy'] = null;
    if (projectsRemainingBeforeCommission !== null) {
      const futureResult = await this.getCommission({
        designerId: vendorId,
        projectAmountPaise: 0,
      });
      // Simulate with more projects
      const futureProjects = projectsCompleted + (projectsRemainingBeforeCommission ?? 0) + 1;
      for (const policy of policies) {
        const designerIds = policy.applicableDesignerIds;
        if (designerIds.length > 0 && !designerIds.includes(vendorId)) continue;
        const c = policy.conditions;
        if (c.projectCountGreaterThan !== undefined && futureProjects > c.projectCountGreaterThan) {
          nextPolicy = {
            id: policy.id,
            name: policy.name,
            commissionPercent: policy.actions.commissionPercent,
          };
          break;
        }
      }
      if (!nextPolicy && futureResult.isFallback) {
        nextPolicy = { id: null, name: 'Default (10%)', commissionPercent: 10 };
      }
    }

    return {
      vendorId,
      currentPolicy: {
        id: currentResult.matchedPolicyId,
        name: currentResult.matchedPolicyName,
        commissionPercent: currentResult.commissionPercent,
        isFallback: currentResult.isFallback,
        isOverride: override !== null && (!override.expiresAt || new Date() < new Date(override.expiresAt)),
      },
      totalCommissionPaidPaise,
      projectsCompleted,
      projectsRemainingBeforeCommission,
      nextPolicy,
      override,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async getActivePoliciesCached(): Promise<RawPolicy[]> {
    const cached = this.cache.get(ACTIVE_POLICIES_CACHE_KEY);
    if (cached) return cached;
    const policies = await this.fetchActivePolicies();
    this.cache.set(ACTIVE_POLICIES_CACHE_KEY, policies, CACHE_TTL_MS);
    return policies;
  }

  private async fetchActivePolicies(): Promise<RawPolicy[]> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT * FROM commission_policies WHERE "isActive" = true ORDER BY priority DESC
    `.catch(() => []);
    return rows.map(parsePolicy);
  }

  private async assertPolicyExists(id: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM commission_policies WHERE id = ${id} LIMIT 1
    `;
    if (!rows.length) throw new NotFoundException(`Commission policy ${id} not found`);
  }

  private validateConditions(conditions: object) {
    if (typeof conditions !== 'object' || Array.isArray(conditions)) {
      throw new BadRequestException('conditions must be a JSON object');
    }
  }

  private validateActions(actions: object) {
    if (typeof actions !== 'object' || Array.isArray(actions)) {
      throw new BadRequestException('actions must be a JSON object');
    }
    const a = actions as { commissionPercent?: unknown };
    if (a.commissionPercent === undefined || typeof a.commissionPercent !== 'number') {
      throw new BadRequestException('actions.commissionPercent (number) is required');
    }
    if ((a.commissionPercent as number) < 0 || (a.commissionPercent as number) > 100) {
      throw new BadRequestException('actions.commissionPercent must be between 0 and 100');
    }
  }
}
