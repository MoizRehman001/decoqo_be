import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  Inject,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Redis } from 'ioredis';
import { Request } from 'express';

const IDEMPOTENCY_TTL_SECONDS = 86_400; // 24 hours
export const REDIS_CLIENT = 'REDIS_CLIENT';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request>();
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    if (!idempotencyKey) {
      return next.handle();
    }

    const cacheKey = `idempotency:${idempotencyKey}`;
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      this.logger.debug({ message: 'Idempotency cache hit', key: idempotencyKey });
      return of(JSON.parse(cached) as unknown);
    }

    return next.handle().pipe(
      tap(async (response) => {
        await this.redis.setex(cacheKey, IDEMPOTENCY_TTL_SECONDS, JSON.stringify(response));
      }),
    );
  }
}
