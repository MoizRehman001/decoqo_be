import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, ip } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<{ statusCode: number }>();
          this.logger.log({ message: `${method} ${url} ${res.statusCode} +${Date.now() - start}ms`, method, url, statusCode: res.statusCode, duration: Date.now() - start, ip });
        },
        error: (err: Error) => {
          this.logger.error({ message: `${method} ${url} ERROR +${Date.now() - start}ms`, method, url, error: err.message });
        },
      }),
    );
  }
}
