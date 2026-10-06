import { isValidDate } from '@stabilitea/shared';
import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Validates a real calendar date in 'YYYY-MM-DD' form. */
export function IsCalendarDate(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isCalendarDate',
      target: target.constructor,
      propertyName: String(propertyName),
      options: { message: 'Date must be a valid YYYY-MM-DD date', ...options },
      validator: { validate: (value: unknown) => isValidDate(value) },
    });
  };
}
