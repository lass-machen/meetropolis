import 'dotenv/config';
import { runScenario } from './scenario.js';

async function main() {
  const mode = process.env.MODE || 'node'; // node | browser (später)
  const users = Number(process.env.USERS || 20);
  const rampPerSec = Number(process.env.RAMP || 5);
  const apiBase = process.env.API_BASE || 'http://localhost:2567';
  const livekitUrl = process.env.LIVEKIT_URL || 'ws://localhost:7880';
  const room = process.env.ROOM || 'world';
  const durationSec = Number(process.env.DURATION || 60);
  await runScenario({ mode, users, rampPerSec, apiBase, livekitUrl, room, durationSec });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Loadtest failed:', e);
  process.exit(1);
});


