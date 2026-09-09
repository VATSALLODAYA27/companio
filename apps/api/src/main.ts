import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Sanitized request logging only — never log bodies/headers containing
    // credentials, tokens, or location. See SECURITY.md "Logging policy".
    logger: ['error', 'warn', 'log'],
  });

  const configService = app.get('ConfigService') as {
    get: (key: string) => string | undefined;
  };

  // Security headers
  app.use(helmet());
  app.use(cookieParser());

  // Global input validation — reject unknown/invalid fields on every route
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Never leak stack traces / internal error detail to clients
  app.useGlobalFilters(new AllExceptionsFilter());

  // Explicit CORS allowlist — credentials-mode cookies require an exact
  // origin, never a wildcard.
  const allowedOrigin =
    configService.get('CORS_ALLOWED_ORIGIN') ?? 'http://localhost:3000';
  app.enableCors({
    origin: allowedOrigin,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  const port = Number(configService.get('API_PORT') ?? 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Companio API listening on port ${port}`);
}

bootstrap();
