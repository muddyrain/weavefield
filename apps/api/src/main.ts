import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '127.0.0.1'); // local-only until auth and deployment hardening exist
  console.log(`[api] http://127.0.0.1:${port}/health`);
}

void bootstrap();
