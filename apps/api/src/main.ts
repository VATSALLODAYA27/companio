import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  const configService = app.get(ConfigService);

  // Render (and Cloudflare in front of it) terminate TLS and proxy every
  // request to this container over plain HTTP internally. Without telling
  // Express to trust that one hop, req.secure/req.protocol report http
  // even on a real https:// request, and req.ip reports the proxy's own
  // address instead of the real client's -- which throws off anything
  // keyed by client IP (the throttler guard) and any secure-cookie/https
  // check. `1` trusts exactly one hop, matching Render's own edge.
  //
  // NestFactory.create(AppModule, {...}) without an explicit generic
  // returns INestApplication, which does NOT expose Express's own `.set()`
  // -- only NestExpressApplication does. Reaching through
  // getHttpAdapter().getInstance() gets the real underlying Express `app`
  // instance (which does have `.set()`) without needing to change the
  // type NestFactory.create is called with anywhere else in this file.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Security headers
  app.use(helmet());
  // Cookies are signed with SESSION_SECRET so a tampered session/CSRF
  // cookie value is rejected before it ever reaches a guard — the real
  // authorization check is still the server-side session lookup, this
  // is defense in depth on top of it.
  app.use(cookieParser(configService.get<string>('SESSION_SECRET')));

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

  // `PORT` takes priority over `API_PORT`: Render (and most PaaS free
  // tiers) inject PORT and require the app to bind to it — see
  // DEPLOYMENT.md's "Free-tier deployment" section. Local dev never sets
  // PORT, so API_PORT (defaulting to 4000) still governs there exactly as
  // before. Binding to 0.0.0.0 explicitly (not just the port) so the
  // container accepts connections from outside its own network namespace.
  const port = Number(configService.get('PORT') ?? configService.get('API_PORT') ?? 4000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Companio API listening on port ${port}`);
}

bootstrap();
