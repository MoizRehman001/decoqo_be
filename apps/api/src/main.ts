import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';
import { LoggingInterceptor } from '@common/interceptors/logging.interceptor';
import { winstonLogger } from './common/logger/winston.logger';
import { PrismaExceptionFilter } from '@common/filters/prisma-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: winstonLogger,
    rawBody: true, // Required for Razorpay webhook signature verification
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3001);
  const allowedOrigins = configService.get<string>('ALLOWED_ORIGINS', '').split(',');
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  // ── Security ──────────────────────────────────────────────────────────────
  app.use(helmet.default());
  app.use(compression());
  app.use(cookieParser());
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });

  // ── Global prefix & versioning ────────────────────────────────────────────
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // ── Global pipes ──────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: false,
    }),
  );

  // ── Global filters ────────────────────────────────────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter(), new PrismaExceptionFilter());

  // ── Global interceptors ───────────────────────────────────────────────────
  app.useGlobalInterceptors(new ResponseTransformInterceptor(), new LoggingInterceptor());

  // ── Swagger (non-production only) ─────────────────────────────────────────
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Decoqo — Interior Execution Marketplace')
      .setDescription(`
## 🏠 Decoqo Platform — Trust Core MVP

**India's most trusted interior execution platform** where design intent, scope, and money flow are always synchronized.

---

### 🎯 What This Platform Does

A customer defines their interior space, optionally generates AI designs, publishes the project for **anonymous bidding**, selects a vendor, locks a BOQ, funds escrow per milestone, approves completed work, and releases payment — all within the platform with a full audit trail.

---

### 🔐 Authentication
All protected endpoints require a **Bearer JWT token**.
1. Register via \`POST /api/v1/auth/register/customer\` or \`POST /api/v1/auth/register/vendor\`
2. Verify OTP via \`POST /api/v1/auth/otp/verify\`
3. Login via \`POST /api/v1/auth/login\` → get \`accessToken\`
4. Click **Authorize** button above → paste \`accessToken\`

---

### 🏗️ Core Trust Loop

\`\`\`
Customer creates project → AI design (optional) → Publish for bidding
→ Vendors bid anonymously → Customer selects vendor
→ Milestone negotiation → BOQ creation & lock
→ Escrow funding → Vendor executes → Customer approves
→ Escrow released → Ratings → Project closed
\`\`\`

---

### 📦 Modules

| Module | Description |
|--------|-------------|
| **auth** | Registration, OTP, JWT, refresh tokens |
| **users** | Customer profile management |
| **vendors** | Vendor profiles, KYC (PAN + bank verification) |
| **projects** | Dual-path project creation (AI-first + Bidding-only) |
| **bidding** | Anonymous Bidding Room — unlimited bids, vendor profile card |
| **negotiation** | Post-selection in-app negotiation with contact masking |
| **milestones** | Milestone definition, locking, execution, approval |
| **boq** | Bill of Quantities — create, version, lock, variations |
| **payments** | Razorpay Route escrow — fund, release, refund |
| **disputes** | Raise dispute, upload evidence, admin decision |
| **chat** | Milestone-scoped chat with contact masking |
| **admin** | Escrow monitor, KYC approval, user management |
| **ratings** | Post-closure ratings |
| **uploads** | S3 pre-signed URL generation |

---

### 💰 Money Format
All monetary values are in **paise** (1 INR = 100 paise) in the database.
API responses show values in **INR** for readability.

---

### 🔒 Key Business Rules
- Vendor identity is **never revealed** during bidding phase
- Vendor **cannot start** a milestone unless escrow is funded
- All chat messages are **contact-masked** (phone/email removed)
- BOQ lock is the **commercial source of truth**
- Locked design is the **contractual visual reference**
- All financial events are **idempotent** and **append-only**

---

**Version**: 1.0.0 | **Stack**: NestJS + TypeScript + PostgreSQL + Razorpay Route
      `)
      .setVersion('1.0.0')
      .setContact('Decoqo Engineering', 'https://decoqo.com', 'engineering@decoqo.com')
      .setLicense('Private', 'https://decoqo.com')
      .addServer(`http://localhost:${port}`, 'Local')
      .addServer('https://dev.decoqo.com', 'Development')
      .addServer('https://uat.decoqo.com', 'UAT / Staging')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Enter your JWT access token' }, 'access-token')
      .addTag('auth', '🔐 Authentication & Authorization')
      .addTag('admin-provisioning', '🛡️ Admin Provisioning — SUPER_ADMIN only, Swagger access only')
      .addTag('users', '👤 User & Customer Profiles')
      .addTag('vendors', '🏢 Vendor Profiles & KYC')
      .addTag('projects', '🏠 Project Management')
      .addTag('bidding', '🎯 Anonymous Bidding Room')
      .addTag('negotiation', '💬 Post-Selection Negotiation')
      .addTag('milestones', '📋 Milestone Management')
      .addTag('boq', '📊 Bill of Quantities')
      .addTag('payments', '💰 Escrow & Payments')
      .addTag('disputes', '⚖️ Dispute Resolution')
      .addTag('chat', '💬 In-App Chat')
      .addTag('admin', '🛡️ Admin Console')
      .addTag('ratings', '⭐ Ratings')
      .addTag('uploads', '📁 File Uploads')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
        docExpansion: 'none',
        defaultModelsExpandDepth: 2,
        syntaxHighlight: { activate: true, theme: 'tomorrow-night' },
      },
      customSiteTitle: 'Decoqo API Docs',
      customfavIcon: 'https://nestjs.com/img/logo_text.svg',
      customJsStr: `
        (function() {
          const STORAGE_KEY = 'decoqo-swagger-theme';
          const saved = localStorage.getItem(STORAGE_KEY) || 'light';

          function applyTheme(theme) {
            document.body.classList.remove('light-theme', 'dark-theme');
            document.body.classList.add(theme + '-theme');
            localStorage.setItem(STORAGE_KEY, theme);
            const btn = document.getElementById('theme-toggle-btn');
            if (btn) btn.textContent = theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
          }

          function addToggleButton() {
            if (document.getElementById('theme-toggle-btn')) return;
            const btn = document.createElement('button');
            btn.id = 'theme-toggle-btn';
            btn.textContent = saved === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
            btn.onclick = function() {
              const current = document.body.classList.contains('dark-theme') ? 'dark' : 'light';
              applyTheme(current === 'dark' ? 'light' : 'dark');
            };
            document.body.appendChild(btn);
          }

          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
              applyTheme(saved);
              addToggleButton();
            });
          } else {
            applyTheme(saved);
            setTimeout(addToggleButton, 300);
          }
        })();
      `,
      customCss: `
        /* ── Toggle button ─────────────────────────────────── */
        #theme-toggle-btn {
          position: fixed;
          top: 14px;
          right: 20px;
          z-index: 9999;
          padding: 7px 16px;
          border-radius: 20px;
          border: 2px solid #61affe;
          background: transparent;
          color: #61affe;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: sans-serif;
          letter-spacing: 0.5px;
        }
        #theme-toggle-btn:hover {
          background: #61affe;
          color: #fff;
        }

        /* ── LIGHT THEME (default) ─────────────────────────── */
        body.light-theme {
          background: #fafafa;
        }
        body.light-theme .swagger-ui .topbar {
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
          padding: 12px 0;
        }
        body.light-theme .swagger-ui .topbar .topbar-wrapper .link span {
          color: #ffffff;
          font-size: 18px;
          font-weight: 700;
        }
        body.light-theme .swagger-ui .info .title {
          color: #1a1a2e;
          font-size: 28px;
        }
        body.light-theme .swagger-ui .info .description p {
          color: #333;
        }
        body.light-theme .swagger-ui .opblock-tag {
          color: #1a1a2e;
          font-size: 16px;
          font-weight: 700;
          border-bottom: 2px solid #e8e8e8;
        }
        body.light-theme .swagger-ui .opblock.opblock-post .opblock-summary {
          border-color: #49cc90;
          background: rgba(73,204,144,.1);
        }
        body.light-theme .swagger-ui .opblock.opblock-get .opblock-summary {
          border-color: #61affe;
          background: rgba(97,175,254,.1);
        }
        body.light-theme .swagger-ui .opblock.opblock-delete .opblock-summary {
          border-color: #f93e3e;
          background: rgba(249,62,62,.1);
        }
        body.light-theme .swagger-ui .opblock.opblock-patch .opblock-summary {
          border-color: #50e3c2;
          background: rgba(80,227,194,.1);
        }
        body.light-theme .swagger-ui .btn.execute {
          background: #4990e2;
          border-color: #4990e2;
          color: #fff;
        }
        body.light-theme .swagger-ui .btn.authorize {
          background: #49cc90;
          border-color: #49cc90;
          color: #fff;
        }

        /* ── DARK THEME ────────────────────────────────────── */
        body.dark-theme {
          background: #0d1117;
        }
        body.dark-theme .swagger-ui {
          filter: none;
          background: #0d1117;
        }
        body.dark-theme .swagger-ui .topbar {
          background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
          border-bottom: 1px solid #30363d;
          padding: 12px 0;
        }
        body.dark-theme .swagger-ui .topbar .topbar-wrapper .link span {
          color: #58a6ff;
          font-size: 18px;
          font-weight: 700;
        }
        body.dark-theme .swagger-ui .wrapper {
          background: #0d1117;
        }
        body.dark-theme .swagger-ui .info .title {
          color: #e6edf3;
          font-size: 28px;
        }
        body.dark-theme .swagger-ui .info .description,
        body.dark-theme .swagger-ui .info .description p,
        body.dark-theme .swagger-ui .info .description li,
        body.dark-theme .swagger-ui .info .description td,
        body.dark-theme .swagger-ui .info .description th {
          color: #c9d1d9 !important;
        }
        body.dark-theme .swagger-ui .info .description h2,
        body.dark-theme .swagger-ui .info .description h3 {
          color: #58a6ff !important;
        }
        body.dark-theme .swagger-ui .info .description table {
          border-color: #30363d;
        }
        body.dark-theme .swagger-ui .info .description code {
          background: #161b22;
          color: #79c0ff;
          padding: 2px 6px;
          border-radius: 4px;
        }
        body.dark-theme .swagger-ui .info .description pre {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 12px;
          color: #c9d1d9;
        }
        body.dark-theme .swagger-ui .scheme-container {
          background: #161b22;
          border-bottom: 1px solid #30363d;
          box-shadow: none;
        }
        body.dark-theme .swagger-ui .opblock-tag {
          color: #e6edf3;
          border-bottom: 1px solid #30363d;
          font-size: 16px;
          font-weight: 700;
        }
        body.dark-theme .swagger-ui .opblock-tag:hover {
          background: #161b22;
        }
        body.dark-theme .swagger-ui .opblock {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 6px;
          margin-bottom: 4px;
          box-shadow: none;
        }
        body.dark-theme .swagger-ui .opblock .opblock-summary {
          border-bottom: 1px solid #30363d;
        }
        body.dark-theme .swagger-ui .opblock .opblock-summary-description {
          color: #c9d1d9;
        }
        body.dark-theme .swagger-ui .opblock .opblock-summary-path {
          color: #e6edf3;
        }
        body.dark-theme .swagger-ui .opblock.opblock-post {
          border-color: #238636;
          background: rgba(35,134,54,.08);
        }
        body.dark-theme .swagger-ui .opblock.opblock-post .opblock-summary {
          background: rgba(35,134,54,.12);
        }
        body.dark-theme .swagger-ui .opblock.opblock-get {
          border-color: #1f6feb;
          background: rgba(31,111,235,.08);
        }
        body.dark-theme .swagger-ui .opblock.opblock-get .opblock-summary {
          background: rgba(31,111,235,.12);
        }
        body.dark-theme .swagger-ui .opblock.opblock-delete {
          border-color: #da3633;
          background: rgba(218,54,51,.08);
        }
        body.dark-theme .swagger-ui .opblock.opblock-patch {
          border-color: #9e6a03;
          background: rgba(158,106,3,.08);
        }
        body.dark-theme .swagger-ui .opblock-body {
          background: #0d1117;
        }
        body.dark-theme .swagger-ui .opblock-section-header {
          background: #161b22;
          border-bottom: 1px solid #30363d;
        }
        body.dark-theme .swagger-ui .opblock-section-header h4 {
          color: #e6edf3;
        }
        body.dark-theme .swagger-ui table thead tr th,
        body.dark-theme .swagger-ui table thead tr td {
          color: #8b949e;
          border-bottom: 1px solid #30363d;
        }
        body.dark-theme .swagger-ui table tbody tr td {
          color: #c9d1d9;
          border-bottom: 1px solid #21262d;
        }
        body.dark-theme .swagger-ui .parameter__name {
          color: #79c0ff;
        }
        body.dark-theme .swagger-ui .parameter__type {
          color: #7ee787;
        }
        body.dark-theme .swagger-ui .parameter__in {
          color: #8b949e;
        }
        body.dark-theme .swagger-ui .parameter__deprecated {
          color: #f85149;
        }
        body.dark-theme .swagger-ui .response-col_status {
          color: #7ee787;
        }
        body.dark-theme .swagger-ui .response-col_description {
          color: #c9d1d9;
        }
        body.dark-theme .swagger-ui .responses-inner h4,
        body.dark-theme .swagger-ui .responses-inner h5 {
          color: #e6edf3;
        }
        body.dark-theme .swagger-ui input[type=text],
        body.dark-theme .swagger-ui input[type=password],
        body.dark-theme .swagger-ui input[type=search],
        body.dark-theme .swagger-ui input[type=email],
        body.dark-theme .swagger-ui textarea,
        body.dark-theme .swagger-ui select {
          background: #0d1117;
          color: #e6edf3;
          border: 1px solid #30363d;
          border-radius: 6px;
        }
        body.dark-theme .swagger-ui input[type=text]:focus,
        body.dark-theme .swagger-ui textarea:focus {
          border-color: #58a6ff;
          outline: none;
          box-shadow: 0 0 0 3px rgba(88,166,255,.1);
        }
        body.dark-theme .swagger-ui .btn {
          border-radius: 6px;
          font-weight: 600;
        }
        body.dark-theme .swagger-ui .btn.execute {
          background: #1f6feb;
          border-color: #1f6feb;
          color: #fff;
        }
        body.dark-theme .swagger-ui .btn.execute:hover {
          background: #388bfd;
        }
        body.dark-theme .swagger-ui .btn.authorize {
          background: #238636;
          border-color: #238636;
          color: #fff;
        }
        body.dark-theme .swagger-ui .btn.authorize:hover {
          background: #2ea043;
        }
        body.dark-theme .swagger-ui .btn.cancel {
          background: transparent;
          border-color: #da3633;
          color: #f85149;
        }
        body.dark-theme .swagger-ui .model-box {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 6px;
        }
        body.dark-theme .swagger-ui .model {
          color: #c9d1d9;
        }
        body.dark-theme .swagger-ui .prop-type {
          color: #7ee787;
        }
        body.dark-theme .swagger-ui .prop-format {
          color: #8b949e;
        }
        body.dark-theme .swagger-ui section.models {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 6px;
        }
        body.dark-theme .swagger-ui section.models h4 {
          color: #e6edf3;
          border-bottom: 1px solid #30363d;
        }
        body.dark-theme .swagger-ui .model-title {
          color: #79c0ff;
        }
        body.dark-theme .swagger-ui .highlight-code {
          background: #0d1117;
        }
        body.dark-theme .swagger-ui .microlight {
          background: #0d1117;
          color: #c9d1d9;
        }
        body.dark-theme .swagger-ui .dialog-ux .modal-ux {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 8px;
        }
        body.dark-theme .swagger-ui .dialog-ux .modal-ux-header {
          background: #0d1117;
          border-bottom: 1px solid #30363d;
        }
        body.dark-theme .swagger-ui .dialog-ux .modal-ux-header h3 {
          color: #e6edf3;
        }
        body.dark-theme .swagger-ui .dialog-ux .modal-ux-content {
          color: #c9d1d9;
        }
        body.dark-theme .swagger-ui .auth-container {
          background: #161b22;
        }
        body.dark-theme .swagger-ui .auth-container h4,
        body.dark-theme .swagger-ui .auth-container h6 {
          color: #e6edf3;
        }
        body.dark-theme .swagger-ui .auth-container .wrapper {
          background: #0d1117;
        }
        body.dark-theme .swagger-ui .filter .operation-filter-input {
          background: #0d1117;
          color: #e6edf3;
          border: 1px solid #30363d;
          border-radius: 6px;
        }
        body.dark-theme .swagger-ui .servers > label {
          color: #c9d1d9;
        }
        body.dark-theme .swagger-ui .servers > label select {
          background: #0d1117;
          color: #e6edf3;
          border: 1px solid #30363d;
        }
        body.dark-theme #theme-toggle-btn {
          border-color: #58a6ff;
          color: #58a6ff;
        }
        body.dark-theme #theme-toggle-btn:hover {
          background: #58a6ff;
          color: #0d1117;
        }
      `,
    });
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  app.enableShutdownHooks();

  await app.listen(port);

  const appUrl = `http://localhost:${port}`;
  const swaggerUrl = `${appUrl}/api/docs`;
  const isSwaggerEnabled = nodeEnv !== 'production';

  // ── Startup banner ────────────────────────────────────────────────────────
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║           🚀  DECOQO API  STARTED                    ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Environment  : ${nodeEnv.padEnd(35)}║`);
  console.log(`║  API URL      : ${appUrl.padEnd(35)}║`);
  console.log(`║  API Base     : ${(appUrl + '/api/v1').padEnd(35)}║`);
  if (isSwaggerEnabled) {
    console.log(`║  Swagger UI   : ${swaggerUrl.padEnd(35)}║`);
    console.log(`║  Swagger JSON : ${(swaggerUrl + '-json').padEnd(35)}║`);
  } else {
    console.log('║  Swagger UI   : disabled in production               ║');
  }
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('\n');

  winstonLogger.log(
    { message: 'Decoqo API started', port, environment: nodeEnv, apiUrl: appUrl, swaggerUrl: isSwaggerEnabled ? swaggerUrl : 'disabled' },
    'Bootstrap',
  );
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
