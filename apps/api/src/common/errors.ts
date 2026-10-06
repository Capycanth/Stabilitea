import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { monthLabel, type ApiErrorBody } from '@stabilitea/shared';

export function validationError(fieldErrors: Record<string, string[]>, message = 'Validation failed'): BadRequestException {
  const body: ApiErrorBody = { statusCode: 400, code: 'VALIDATION_FAILED', message, fieldErrors };
  return new BadRequestException(body);
}

export function fieldError(field: string, message: string): BadRequestException {
  return validationError({ [field]: [message] }, message);
}

export function monthClosed(month: string): ConflictException {
  const body: ApiErrorBody = {
    statusCode: 409,
    code: 'MONTH_CLOSED',
    message: `${monthLabel(month)} is closed. Reopen it to make changes.`,
  };
  return new ConflictException(body);
}

export function conflict(message: string): ConflictException {
  const body: ApiErrorBody = { statusCode: 409, code: 'CONFLICT', message };
  return new ConflictException(body);
}

export function notFound(message: string): NotFoundException {
  const body: ApiErrorBody = { statusCode: 404, code: 'NOT_FOUND', message };
  return new NotFoundException(body);
}
