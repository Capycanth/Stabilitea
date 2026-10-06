import type { INestApplication } from '@nestjs/common';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { createValidationPipe } from './common/pipes.js';

/** Shared by main.ts and e2e tests so both run the exact same pipeline. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
