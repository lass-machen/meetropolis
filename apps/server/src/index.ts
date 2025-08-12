import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Use CJS require for Colyseus to avoid ESM interop issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Colyseus = require('colyseus');
import { createServer } from 'http';
import { WorldRoom } from './rooms/WorldRoom';
import { registerApi } from './api';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => res.send('ok'));

registerApi(app);

const port = Number(process.env.PORT ?? 2567);
const httpServer = createServer(app);
httpServer.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('HTTP server error', err);
});

// Attach to existing HTTP server; compatible with Colyseus 0.14/0.15
// Colyseus Server
const gameServer = new Colyseus.Server({ server: httpServer as any });

gameServer.define('world', WorldRoom as any);

httpServer.listen(port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on :${port}`);
});
