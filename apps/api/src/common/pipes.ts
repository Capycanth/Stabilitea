import { type PipeTransform, ValidationPipe, type ValidationError } from '@nestjs/common';
import { isValidMonth } from '@stabilitea/shared';
import { fieldError, validationError } from './errors.js';

/** Validates a 'YYYY-MM' route parameter. */
export class ParseMonthPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isValidMonth(value)) throw fieldError('month', 'Month must be in YYYY-MM format');
    return value;
  }
}

function collect(errors: ValidationError[], parent = '', out: Record<string, string[]> = {}): Record<string, string[]> {
  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      out[field] = [...(out[field] ?? []), ...Object.values(error.constraints)];
    }
    if (error.children?.length) collect(error.children, field, out);
  }
  return out;
}

/** Global DTO validation that maps class-validator output onto field-level errors. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors) => validationError(collect(errors)),
  });
}
