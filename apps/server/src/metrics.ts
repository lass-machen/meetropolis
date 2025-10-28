import client from 'prom-client';

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

// Colyseus: Räume und Spieler
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

export function metricsMiddleware() {
  return function (req: any, res: any, next: any) {
    const start = process.hrtime.bigint();
    // route wird evtl. erst nach Routing verfügbar; fallback auf originalUrl
    res.on('finish', () => {
      try {
        const end = process.hrtime.bigint();
        const dur = Number(end - start) / 1e9; // Sekunden
        const method = (req.method || 'GET').toUpperCase();
        const route = (req.route?.path || req.originalUrl || 'unknown') as string;
        const status = String(res.statusCode || 0);
        httpRequestDuration.labels(method, route, status).observe(dur);
      } catch {}
    });
    next();
  };
}


