import { isValidDate, isValidMonth } from '@stabilitea/shared';
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

/** Validates a month key in 'YYYY-MM' form. */
export function IsMonthKey(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isMonthKey',
      target: target.constructor,
      propertyName: String(propertyName),
      options: { message: 'Month must be a valid YYYY-MM month', ...options },
      validator: { validate: (value: unknown) => isValidMonth(value) },
    });
  };
}
