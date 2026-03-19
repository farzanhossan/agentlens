import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createGunzip } from 'zlib';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Readable } from 'stream';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = app.get(ConfigService);

  app.enableCors({ origin: true, credentials: true });

  // Swagger only in non-production environments
  if (process.env['NODE_ENV'] !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('AgentLens API')
      .setDescription('AI agent observability platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
    Logger.log('Swagger docs available at /docs', 'Bootstrap');
  }

  const fastify = app.getHttpAdapter().getInstance();

  // Decompress gzip request bodies before the JSON parser sees them.
  // The SDK sends spans with Content-Encoding: gzip; this hook transparently
  // decompresses the stream so the default JSON parser works as normal.
  fastify.addHook(
    'preParsing',
    async (req: FastifyRequest, _reply: FastifyReply, payload: Readable): Promise<Readable> => {
      if (req.headers['content-encoding'] === 'gzip') {
        delete req.headers['content-encoding'];
        return payload.pipe(createGunzip()) as unknown as Readable;
      }
      return payload;
    },
  );

  fastify.get('/health', (_req: unknown, reply: { send: (v: unknown) => void }) => {
    reply.send({ status: 'ok', ts: Date.now() });
  });

  // Graceful shutdown — flush queues and close DB connections on SIGTERM
  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3001);
  const host = config.get<string>('HOST', '0.0.0.0');

  await app.listen(port, host);
  Logger.log(`AgentLens API listening on http://${host}:${port}`, 'Bootstrap');
}

void bootstrap();
