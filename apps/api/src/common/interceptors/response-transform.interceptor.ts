import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === 'object' && 'success' in data) return data;
        if (data && typeof data === 'object' && 'data' in data && 'meta' in data) {
          const { data: inner, meta } = data as { data: T; meta: Record<string, unknown> };
          return { success: true, data: inner, meta };
        }
        return { success: true, data };
      }),
    );
  }
}
