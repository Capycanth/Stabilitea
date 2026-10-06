import { HttpErrorResponse } from '@angular/common/http';
import type { ApiErrorBody } from '@stabilitea/shared';

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

/** Normalizes any thrown value into the API's error shape. */
export function toApiError(error: unknown): ApiErrorBody {
  if (error instanceof HttpErrorResponse) {
    if (isApiErrorBody(error.error)) return error.error;
    if (error.status === 0) {
      return { statusCode: 0, code: 'INTERNAL', message: 'Could not reach the Stabilitea API. Is it running?' };
    }
    return { statusCode: error.status, code: 'INTERNAL', message: error.message };
  }
  return { statusCode: 0, code: 'INTERNAL', message: error instanceof Error ? error.message : 'Something went wrong' };
}

/** First message for display. */
export function errorMessage(error: unknown): string {
  const body = toApiError(error);
  const firstField = body.fieldErrors ? Object.values(body.fieldErrors)[0]?.[0] : undefined;
  return firstField ?? body.message;
}
