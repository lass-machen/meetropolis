import client from 'prom-client';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Zentrales Registry-Objekt (nicht global)
export const registry = new client.Registry();

// Default-Metriken (CPU, RSS, Eventloop, GC)
client.collectDefaultMetrics({ register: registry, prefix: 'meetropolis_' });

// HTTP Request Dauer
export const httpRequestDuration = new client.Histogram({
  name: 'meetropolis_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});
registry.registerMetric(httpRequestDuration);

// Colyseus: rooms and players.
export const colyseusRooms = new client.Gauge({
  name: 'meetropolis_colyseus_rooms',
  help: 'Number of active Colyseus rooms',
});
registry.registerMetric(colyseusRooms);

export const colyseusPlayers = new client.Gauge({
  name: 'meetropolis_colyseus_players',
  help: 'Number of connected players across rooms',
});
registry.registerMetric(colyseusPlayers);

// LiveKit/WebRTC client-reported stats
export const livekitSamples = new client.Counter({
  name: 'meetropolis_livekit_stats_samples_total',
  help: 'Number of client-reported WebRTC stats samples',
});
registry.registerMetric(livekitSamples);

export const livekitRttSeconds = new client.Histogram({
  name: 'meetropolis_livekit_rtt_seconds',
  help: 'Round-trip-time (RTT) reported by clients',
  buckets: [0.01, 0.03, 0.05, 0.1, 0.2, 0.5, 1, 2],
});
registry.registerMetric(livekitRttSeconds);

export const livekitJitterSeconds = new client.Histogram({
  name: 'meetropolis_livekit_jitter_seconds',
  help: 'Jitter reported by clients',
  buckets: [0.001, 0.003, 0.005, 0.01, 0.02, 0.05, 0.1],
});
registry.registerMetric(livekitJitterSeconds);

export const livekitInboundBitrateBps = new client.Histogram({
  name: 'meetropolis_livekit_inbound_bitrate_bps',
  help: 'Inbound bitrate in bits per second reported by clients',
  buckets: [1e3, 5e3, 1e4, 5e4, 1e5, 3e5, 6e5, 1e6, 2e6, 5e6, 1e7],
});
registry.registerMetric(livekitInboundBitrateBps);

export const livekitOutboundBitrateBps = new client.Histogram({
  name: 'meetropolis_livekit_outbound_bitrate_bps',
  help: 'Outbound bitrate in bits per second reported by clients',
  buckets: [1e3, 5e3, 1e4, 5e4, 1e5, 3e5, 6e5, 1e6, 2e6, 5e6, 1e7],
});
registry.registerMetric(livekitOutboundBitrateBps);

export const livekitPacketLossRatio = new client.Histogram({
  name: 'meetropolis_livekit_packet_loss_ratio',
  help: 'Packet loss ratio (0..1) reported by clients',
  buckets: [0.001, 0.003, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2],
});
registry.registerMetric(livekitPacketLossRatio);

export function metricsMiddleware(): RequestHandler {
  return function (req: Request, res: Response, next: NextFunction) {
    const start = process.hrtime.bigint();
    // The route may only become available after routing; fall back to originalUrl.
    res.on('finish', () => {
      try {
        const end = process.hrtime.bigint();
        const dur = Number(end - start) / 1e9; // Seconds.
        const method = (req.method || 'GET').toUpperCase();
        // express-serve-static-core types req.route as `any`; narrow defensively.
        const routeObj = req.route as { path?: unknown } | undefined;
        const routePath = typeof routeObj?.path === 'string' ? routeObj.path : undefined;
        const route = routePath ?? req.originalUrl ?? 'unknown';
        const status = String(res.statusCode || 0);
        httpRequestDuration.labels(method, route, status).observe(dur);
      } catch (_error) {
        // Silently ignore metrics errors - metrics should never break request handling
        // This is an acceptable silent catch because:
        // 1. We're in a response finalizer (res.on('finish'))
        // 2. Metrics are non-critical observability data
        // 3. Logging here could cause infinite loops if logger uses HTTP
      }
    });
    next();
  };
}
