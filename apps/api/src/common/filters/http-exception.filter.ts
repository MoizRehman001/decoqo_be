import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const errorBody =
      typeof exceptionResponse === 'string'
        ? { message: exceptionResponse }
        : (exceptionResponse as Record<string, unknown>);

    const errorResponse = {
      success: false,
      error: {
        code: this.getErrorCode(status, errorBody),
        message: this.getErrorMessage(errorBody),
        details: errorBody['details'] ?? null,
      },
      meta: { timestamp: new Date().toISOString(), path: request.url, method: request.method },
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ message: 'HTTP Exception', status, path: request.url, error: exception.message });
    }

    response.status(status).json(errorResponse);
  }

  private getErrorCode(status: number, body: Record<string, unknown>): string {
    if (body['code']) return String(body['code']);
    const map: Record<number, string> = {
      400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
      404: 'NOT_FOUND', 409: 'CONFLICT', 422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS', 500: 'INTERNAL_SERVER_ERROR',
    };
    return map[status] ?? 'UNKNOWN_ERROR';
  }

  private getErrorMessage(body: Record<string, unknown>): string {
    if (Array.isArray(body['message'])) return (body['message'] as string[]).join('; ');
    return String(body['message'] ?? 'An error occurred');
  }
}
