/**
 * Prisma Seed Script
 * Seeds initial data for local and dev environments.
 * Run: npm run db:seed:local
 */
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── Policy Versions ────────────────────────────────────────────────────────
  await prisma.policyVersion.upsert({
    where: { id: 'policy-terms-customer-v1' },
    update: {},
    create: {
      id: 'policy-terms-customer-v1',
      type: 'TERMS_CUSTOMER',
      version: '1.0.0',
      content: 'Customer Terms and Conditions v1.0.0',
      effectiveAt: new Date('2026-01-01'),
    },
  });

  await prisma.policyVersion.upsert({
    where: { id: 'policy-terms-vendor-v1' },
    update: {},
    create: {
      id: 'policy-terms-vendor-v1',
      type: 'TERMS_VENDOR',
      version: '1.0.0',
      content: 'Vendor Agreement v1.0.0',
      effectiveAt: new Date('2026-01-01'),
    },
  });

  await prisma.policyVersion.upsert({
    where: { id: 'policy-privacy-v1' },
    update: {},
    create: {
      id: 'policy-privacy-v1',
      type: 'PRIVACY_POLICY',
      version: '1.0.0',
      content: 'Privacy Policy v1.0.0',
      effectiveAt: new Date('2026-01-01'),
    },
  });

  // ── Admin User ─────────────────────────────────────────────────────────────
  const adminPasswordHash = await bcrypt.hash('Admin@123456', 12);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@decoqo.com' },
    update: {},
    create: {
      email: 'admin@decoqo.com',
      passwordHash: adminPasswordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: false,
    },
  });
  console.log(`✅ Admin user: ${adminUser.email}`);

  // ── Super Admin User ───────────────────────────────────────────────────────
  const superAdminPasswordHash = await bcrypt.hash('SuperAdmin@123456', 12);

  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@decoqo.com' },
    update: {},
    create: {
      email: 'superadmin@decoqo.com',
      passwordHash: superAdminPasswordHash,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: false,
    },
  });
  console.log(`✅ Super Admin user: ${superAdmin.email}`);

  // ── Test Customer ──────────────────────────────────────────────────────────
  const customerPasswordHash = await bcrypt.hash('Customer@123456', 12);

  const customerUser = await prisma.user.upsert({
    where: { email: 'customer@decoqo.com' },
    update: {},
    create: {
      email: 'customer@decoqo.com',
      phone: '+919876543210',
      passwordHash: customerPasswordHash,
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
      customerProfile: {
        create: {
          displayName: 'Test Customer',
          city: 'Bengaluru',
        },
      },
    },
  });
  console.log(`✅ Test customer: ${customerUser.email}`);

  // ── Test Vendor ────────────────────────────────────────────────────────────
  const vendorPasswordHash = await bcrypt.hash('Vendor@123456', 12);

  const vendorUser = await prisma.user.upsert({
    where: { email: 'vendor@decoqo.com' },
    update: {},
    create: {
      email: 'vendor@decoqo.com',
      phone: '+919876543211',
      passwordHash: vendorPasswordHash,
      role: UserRole.VENDOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
      vendorProfile: {
        create: {
          businessName: 'Test Interiors Pvt Ltd',
          displayName: 'Test Vendor',
          city: 'Bengaluru',
          serviceAreas: ['Bengaluru', 'Mysuru'],
          categories: ['MODULAR_KITCHEN', 'FALSE_CEILING', 'FLOORING'],
          kycStatus: 'APPROVED',
          isApproved: true,
          averageRating: 4.5,
          totalProjects: 10,
        },
      },
    },
  });
  console.log(`✅ Test vendor: ${vendorUser.email}`);

  console.log('\n🎉 Seed complete!');
  console.log('\nTest credentials:');
  console.log('  Admin:      admin@decoqo.com       / Admin@123456');
  console.log('  SuperAdmin: superadmin@decoqo.com  / SuperAdmin@123456');
  console.log('  Customer:   customer@decoqo.com    / Customer@123456');
  console.log('  Vendor:     vendor@decoqo.com      / Vendor@123456');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
