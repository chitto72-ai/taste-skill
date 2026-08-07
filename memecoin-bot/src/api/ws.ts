import type { FastifyInstance } from 'fastify';
import type { EventName } from '../core/events.js';
import type { ApiContext } from './context.js';

/** Events pushed to dashboard clients as they happen. */
const LIVE_EVENTS: readonly EventName[] = [
  'position.opened',
  'position.closed',
  'position.partial_exit',
  'signal.entry',
  'signal.exit',
  'token.scored',
  'risk.halted',
  'risk.resumed',
  'risk.updated',
  'order.filled',
  'order.rejected',
];

/**
 * Live dashboard feed.
 *
 * Two channels over one socket: immediate event pushes, and a periodic
 * snapshot. The snapshot exists because a client that connects mid-session
 * would otherwise show an empty dashboard until something happens — which, in
 * a risk-halted bot, could be a long time.
 */
export function registerWebsocket(app: FastifyInstance, ctx: ApiContext): void {
  const clients = new Set<{ send(data: string): void; readyState: number }>();

  const broadcast = (type: string, payload: unknown): void => {
    if (clients.size === 0) return;
    const message = JSON.stringify({ type, payload, at: Date.now() });
    for (const client of clients) {
      try {
        // 1 === OPEN
        if (client.readyState === 1) client.send(message);
      } catch {
        clients.delete(client);
      }
    }
  };

  for (const event of LIVE_EVENTS) {
    ctx.events.on(event, (payload) => {
      broadcast(event, summarize(event, payload));
    });
  }

  const timer = setInterval(() => {
    if (clients.size === 0) return;
    void (async () => {
      try {
        broadcast('snapshot', {
          engine: ctx.engine.status(),
          risk: ctx.risk.state(),
          discovery: ctx.scanner.snapshot(),
          positions: ctx.positions.list().map((position) => ({
            id: position.id,
            symbol: position.symbol,
            chain: position.chain,
            entryPrice: position.entryPrice,
            currentPrice: position.currentPrice,
            qty: position.qty,
            unrealizedPnl: position.unrealizedPnl,
            realizedPnl: position.realizedPnl,
            pnlPct: position.entryPrice > 0 ? (position.currentPrice / position.entryPrice - 1) * 100 : 0,
            stopPrice: position.stopPrice,
            trailingArmed: position.trailingArmed,
            openedAt: position.openedAt,
          })),
        });
      } catch {
        // A broken snapshot must not kill the interval.
      }
    })();
  }, ctx.config.api.broadcastIntervalMs);
  timer.unref?.();

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    try {
      socket.send(JSON.stringify({ type: 'hello', payload: ctx.engine.status(), at: Date.now() }));
    } catch {
      clients.delete(socket);
    }
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });

  app.addHook('onClose', async () => {
    clearInterval(timer);
    clients.clear();
  });
}

/** Trims event payloads to what a dashboard actually renders. */
function summarize(event: EventName, payload: unknown): unknown {
  const data = payload as Record<string, unknown>;
  switch (event) {
    case 'position.opened':
    case 'position.partial_exit': {
      const position = data.position as { id: string; symbol: string; chain: string; entryPrice: number; costBasis: number };
      return { id: position.id, symbol: position.symbol, chain: position.chain, entryPrice: position.entryPrice, costBasis: position.costBasis };
    }
    case 'position.closed': {
      const trade = data.trade as { symbol: string; pnl: number; pnlPct: number; closeReason: string; holdMs: number };
      return { symbol: trade.symbol, pnl: trade.pnl, pnlPct: trade.pnlPct, reason: trade.closeReason, holdMs: trade.holdMs };
    }
    case 'token.scored': {
      const profile = data.profile as { metadata: { symbol: string }; ref: { chain: string; address: string } };
      const score = data.score as { total: number; probabilities: unknown };
      return { symbol: profile.metadata.symbol, chain: profile.ref.chain, address: profile.ref.address, score: score.total, probabilities: score.probabilities };
    }
    case 'signal.entry': {
      const signal = data.signal as { strategy: string; conviction: number; token: { address: string } };
      return { strategy: signal.strategy, conviction: signal.conviction, token: signal.token.address };
    }
    case 'signal.exit': {
      const signal = data.signal as { reason: string; note: string; positionId: string };
      return { reason: signal.reason, note: signal.note, positionId: signal.positionId };
    }
    default:
      return payload;
  }
}
