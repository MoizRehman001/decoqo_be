import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '@prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { VendorModule } from './modules/vendor/vendor.module';
import { ProjectModule } from '@modules/project/project.module';
import { AiDesignModule } from './modules/ai-design/ai-design.module';
import { BiddingModule } from '@modules/bidding/bidding.module';
import { MilestoneModule } from '@modules/milestone/milestone.module';
import { BoqModule } from '@modules/boq/boq.module';
import { PaymentModule } from '@modules/payment/payment.module';
import { DisputeModule } from '@modules/dispute/dispute.module';
import { ChatModule } from '@modules/chat/chat.module';
import { TimelineModule } from '@modules/timeline/timeline.module';
import { NotificationModule } from '@modules/notification/notification.module';
import { AdminModule } from '@modules/admin/admin.module';
import { RatingModule } from '@modules/rating/rating.module';
import { StorageModule } from '@modules/storage/storage.module';
import { NegotiationModule } from './modules/negotiation/negotiation.module';
import { CommissionModule } from './modules/commission/commission.module';
import appConfig from '@config/app.config';
import databaseConfig from '@config/database.config';
import redisConfig from '@config/redis.config';
import awsConfig from '@config/aws.config';
import razorpayConfig from '@config/razorpay.config';
import { AnalyticsModule } from './analytics/analytics.module';
import { AnalyticsService } from './analytics/analytics.service';
import analyticsConfig from '@config/analytics.config';

@Module({
  imports: [
    // ── Configuration ──────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig, awsConfig, razorpayConfig, analyticsConfig],
      envFilePath: [
        `.env.${process.env['NODE_ENV'] ?? 'local'}`, // e.g. .env.dev, .env.test, .env.uat, .env.prod
        '.env.local',                                  // local overrides (never committed)
        '.env',                                        // fallback base
      ],
    }),

    // ── Rate Limiting ──────────────────────────────────────────────────────
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'medium', ttl: 60_000, limit: 100 },
      { name: 'long', ttl: 3_600_000, limit: 1000 },
    ]),

    // ── Event Bus ─────────────────────────────────────────────────────────
    EventEmitterModule.forRoot({ wildcard: false, delimiter: '.', maxListeners: 20 }),

    // ── Job Queues ────────────────────────────────────────────────────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      }),
    }),

    // ── Scheduler ─────────────────────────────────────────────────────────
    ScheduleModule.forRoot(),

    // ── Core ──────────────────────────────────────────────────────────────
    PrismaModule,
    RedisModule,
    StorageModule,
    NotificationModule,
    TimelineModule,
    AnalyticsModule,

    // ── Domain Modules ────────────────────────────────────────────────────
    AuthModule,
    UserModule,
    VendorModule,
    ProjectModule,
    AiDesignModule,
    BiddingModule,
    NegotiationModule,
    MilestoneModule,
    BoqModule,
    PaymentModule,
    DisputeModule,
    ChatModule,
    AdminModule,
    RatingModule,
    CommissionModule,
  ],
})
export class AppModule {
  constructor(private readonly analyticsService: AnalyticsService) {
    console.log('AnalyticsService initialized'); // ✅ MUST PRINT
  }
}
