import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Server as ColyseusServer } from 'colyseus';
import { createServer } from 'http';
import { WorldRoom } from './rooms/WorldRoom';
import { registerApi } from './api';

const app = express();
app.use(cors());
app.use(express.json());

registerApi(app);

const port = Number(process.env.PORT ?? 2567);
const httpServer = createServer(app);

// Attach to existing HTTP server; compatible with Colyseus 0.14/0.15
const gameServer = new ColyseusServer({ server: httpServer as any });

gameServer.define('world', WorldRoom);

httpServer.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on :${port}`);
});

