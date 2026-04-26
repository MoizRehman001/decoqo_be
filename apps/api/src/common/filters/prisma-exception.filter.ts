import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientUnknownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientUnknownRequestError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'DATABASE_ERROR';
    let message = 'A database error occurred';

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          code = 'UNIQUE_CONSTRAINT_VIOLATION';
          message = `A record with this ${this.getConflictField(exception)} already exists`;
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          code = 'RECORD_NOT_FOUND';
          message = 'The requested record was not found';
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          code = 'FOREIGN_KEY_CONSTRAINT';
          message = 'Related record not found';
          break;
        default:
          this.logger.error({ message: 'Prisma error', code: exception.code });
      }
    }

    response.status(status).json({ success: false, error: { code, message, details: null } });
  }

  private getConflictField(exception: Prisma.PrismaClientKnownRequestError): string {
    const target = exception.meta?.['target'];
    if (Array.isArray(target)) return target.join(', ');
    return 'field';
  }
}
