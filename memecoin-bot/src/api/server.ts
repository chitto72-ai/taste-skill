import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { HealthReport, Service } from '../core/lifecycle.js';
import type { Logger } from '../logger/logger.js';
import type { ApiContext } from './context.js';
import { registerRoutes } from './routes.js';
import { registerWebsocket } from './ws.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Dashboard and control API.
 *
 * Security posture: bearer-token auth on everything except `/health` and the
 * static dashboard, and the config layer refuses to start with a non-loopback
 * bind and no token. A trading bot's control plane is a "close all positions"
 * button; leaving it open on 0.0.0.0 is not a theoretical risk.
 */
export class ApiServer implements Service {
  readonly name = 'api';
  private app: FastifyInstance | undefined;
  private readonly logger: Logger;

  constructor(private readonly ctx: ApiContext) {
    this.logger = ctx.logger.child(this.name);
  }

  async start(): Promise<void> {
    if (!this.ctx.config.api.enabled) {
      this.logger.info('api disabled by configuration');
      return;
    }

    const app = Fastify({
      logger: false,
      bodyLimit: 1_000_000,
      trustProxy: false,
    });

    await app.register(fastifyWebsocket);

    const token = this.ctx.config.api.token;
    app.addHook('onRequest', async (request, reply) => {
      const url = request.url.split('?')[0];
      const isPublic = url === '/health' || !url.startsWith('/api');
      if (isPublic || !token) return;

      const header = request.headers.authorization ?? '';
      const provided = header.startsWith('Bearer ') ? header.slice(7) : (request.headers['x-api-token'] as string | undefined);
      if (provided !== token) {
        // In an async hook the reply MUST be returned; merely awaiting send()
        // lets Fastify continue to the route handler and answer 200.
        return reply.code(401).send({ error: 'unauthorized' });
      }
      return undefined;
    });

    const origins = this.ctx.config.api.corsOrigins;
    if (origins.length > 0) {
      app.addHook('onSend', async (request, reply, payload) => {
        const origin = request.headers.origin;
        if (origin && origins.includes(origin)) {
          void reply.header('access-control-allow-origin', origin);
          void reply.header('vary', 'Origin');
        }
        return payload;
      });
    }

    app.setErrorHandler(async (error, _request, reply) => {
      this.logger.error({ err: error }, 'request failed');
      await reply.code(500).send({ error: 'internal error' });
    });

    registerRoutes(app, this.ctx);
    registerWebsocket(app, this.ctx);

    // The dashboard ships as a single self-contained file next to the build.
    await app.register(fastifyStatic, {
      root: join(HERE, 'dashboard'),
      prefix: '/',
      index: ['index.html'],
    });

    await app.listen({ host: this.ctx.config.api.host, port: this.ctx.config.api.port });
    this.app = app;
    this.logger.info(
      {
        url: `http://${this.ctx.config.api.host}:${this.ctx.config.api.port}`,
        authenticated: Boolean(token),
      },
      'dashboard available',
    );
  }

  async stop(): Promise<void> {
    await this.app?.close();
    this.app = undefined;
  }

  health(): HealthReport {
    return {
      component: this.name,
      healthy: !this.ctx.config.api.enabled || this.app !== undefined,
      detail: this.app ? `listening on ${this.ctx.config.api.host}:${this.ctx.config.api.port}` : 'not listening',
      checkedAt: Date.now(),
    };
  }
}
