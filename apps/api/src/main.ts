import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { configureApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { HOST, port } from './config.js';

async function bootstrap(): Promise<void> {
  const app = configureApp(await NestFactory.create(AppModule));
  // Local-only: bind to loopback, never 0.0.0.0. No CORS: the web app is same-origin
  // in production and goes through the Angular CLI proxy in development.
  await app.listen(port(), HOST);
  Logger.log(`Stabilitea is running at http://localhost:${port()}`, 'Bootstrap');
}

void bootstrap();
