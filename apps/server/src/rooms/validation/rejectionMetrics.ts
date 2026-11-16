import client from 'prom-client';
import { registry, reuseOrCreateMetric } from '../../metrics.js';

export type RejectedPayloadType = 'move' | 'dnd_status' | 'editor_state';
export type RejectedPayloadReason = 'schema' | 'bounds';

const worldPayloadRejectedTotal = reuseOrCreateMetric(
  'meetropolis_world_payload_rejected_total',
  () =>
    new client.Counter({
      name: 'meetropolis_world_payload_rejected_total',
      help: 'World and editor payloads rejected before state changed',
      labelNames: ['type', 'reason'] as const,
    }),
);
registry.registerMetric(worldPayloadRejectedTotal);

export function countRejectedPayload(type: RejectedPayloadType, reason: RejectedPayloadReason): void {
  worldPayloadRejectedTotal.labels(type, reason).inc();
}
