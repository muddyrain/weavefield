import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json, type NextFunction, type Request, type Response } from 'express';
import { AppModule } from './app.module';
import { authConfig } from './auth/auth.config';

export async function createApplication() {
  const config = authConfig();
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ['error', 'warn'] });
  app.use(json({ limit: '4kb', strict: true }));
  app.use((error: { status?: number }, _request: Request, response: Response, _next: NextFunction) => {
    const status = error.status === 413 ? 413 : 400;
    response.setHeader('Cache-Control', 'no-store');
    response.status(status).json({ statusCode: status, message: '请求体必须是有效且不超过 4 KiB 的 JSON' });
  });
  app.enableCors({ origin: config.origin, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Weavefield-Request'] });
  app.enableShutdownHooks();
  return app;
}
