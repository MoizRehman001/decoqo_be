import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  name: process.env['APP_NAME'] ?? 'Decoqo',
  url: process.env['APP_URL'] ?? 'http://localhost:3000',
  port: parseInt(process.env['PORT'] ?? '3001', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  allowedOrigins: (process.env['ALLOWED_ORIGINS'] ?? '').split(',').filter(Boolean),
  jwtSecret: process.env['JWT_SECRET'] ?? '',
  jwtRefreshSecret: process.env['JWT_REFRESH_SECRET'] ?? '',
  jwtAccessExpiresIn: process.env['JWT_ACCESS_EXPIRES_IN'] ?? '15m',
  jwtRefreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
  moderationServiceUrl: process.env['MODERATION_SERVICE_URL'] ?? 'http://localhost:8000',
  sentryDsn: process.env['SENTRY_DSN'] ?? '',
  smtp: {
    host: process.env['SMTP_HOST'] ?? '',
    port: parseInt(process.env['SMTP_PORT'] ?? '465', 10),
    user: process.env['SMTP_USER'] ?? '',
    password: process.env['SMTP_PASSWORD'] ?? '',
    from: process.env['SMTP_FROM'] ?? process.env['SMTP_USER'] ?? '',
  },
}));
