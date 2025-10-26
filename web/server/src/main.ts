import 'reflect-metadata';
import { WsAdapter } from '@nestjs/platform-ws';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableCors({ origin: true, credentials: true });
  app.useWebSocketAdapter(new WsAdapter(app));
  const env = loadEnv();

  // simple health route via underlying http adapter
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/health', (_req: any, res: any) => res.send({ ok: true }));
  httpAdapter.get('/api/current', (_req: any, res: any) => res.send({ msg: 'use ws at /ws for stream' }));

  await app.listen(env.PORT);
  console.log(`server listening on http://localhost:${env.PORT} (ws at /ws)`);
}
bootstrap();

