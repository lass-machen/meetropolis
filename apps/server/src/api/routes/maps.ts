import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import {
  handleListMaps,
  handleStateV2,
  handleChunksFetch,
  handleListZonesForTenant,
} from './maps.read.js';
import { handlePaintRect } from './maps.paint.js';
import {
  handleAddTileset,
  handleEditorStateGet,
  handleEditorStatePut,
  handleResize,
  handleRename,
  handleDeleteZones,
  handleListMapZones,
} from './maps.editor.js';

export function registerMapRoutes(app: express.Application, prisma: PrismaClient) {
  app.get('/maps', (req, res) => handleListMaps(prisma, req, res));
  app.get('/maps/:id/state-v2', (req, res) => handleStateV2(prisma, req, res));
  app.get('/maps/:id/chunks', (req, res) => handleChunksFetch(prisma, req, res));
  app.patch('/maps/:id/paint-rect', (req, res) => handlePaintRect(prisma, req, res));

  app.post('/maps/:id/tilesets', (req, res) => handleAddTileset(prisma, req, res));

  app.get('/zones', (req, res) => handleListZonesForTenant(prisma, req, res));

  app.get('/maps/:id/editor-state', (req, res) => handleEditorStateGet(prisma, req, res));
  app.put('/maps/:id/editor-state', (req, res) => handleEditorStatePut(prisma, req, res));

  app.patch('/maps/:id/resize', (req, res) => handleResize(prisma, req, res));
  app.patch('/maps/:id/rename', (req, res) => handleRename(prisma, req, res));

  app.delete('/maps/:id/zones', (req, res) => handleDeleteZones(prisma, req, res));
  app.get('/maps/:id/zones', (req, res) => handleListMapZones(prisma, req, res));
}
