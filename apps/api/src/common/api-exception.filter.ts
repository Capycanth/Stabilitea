import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiErrorBody, ApiErrorCode } from '@stabilitea/shared';
import type { Response } from 'express';

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'code' in value && 'statusCode' in value;
}

function codeFor(status: number): ApiErrorCode {
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status >= 500) return 'INTERNAL';
  return 'VALIDATION_FAILED';
}

/** Normalizes every error leaving /api into the shared ApiErrorBody shape. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Api');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (isApiErrorBody(payload)) {
        response.status(status).json(payload);
        return;
      }
      if (status >= 500) this.logger.error(exception.message, exception.stack);
      const message =
        typeof payload === 'object' && payload !== null && 'message' in payload
          ? String((payload as { message: unknown }).message)
          : exception.message;
      const body: ApiErrorBody = { statusCode: status, code: codeFor(status), message };
      response.status(status).json(body);
      return;
    }

    // Prisma unique-constraint violation.
    if (typeof exception === 'object' && exception !== null && (exception as { code?: unknown }).code === 'P2002') {
      const body: ApiErrorBody = { statusCode: 409, code: 'CONFLICT', message: 'That name is already in use.' };
      response.status(HttpStatus.CONFLICT).json(body);
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      code: 'INTERNAL',
      message: 'Unexpected server error',
    } satisfies ApiErrorBody);
  }
}
