import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import {
  handleOssPublicConfig,
  handleAdminHealth,
  handleAdminStats,
  handleDebugRooms,
} from './admin.system.js';

/**
 * OSS-only admin routes — registered AFTER the enterprise admin module
 * (see api.ts). Express dispatches to the first matching handler, so the
 * enterprise variant of /public/config wins when the module is present.
 *
 * In OSS-only installs (no enterprise submodule), this minimal /public/config
 * reflects the PUBLIC_REGISTRATION_ENABLED env flag. Multi-tenant management,
 * pricing plans and DB-backed settings are entirely enterprise-only.
 */
export function registerAdminRoutes(app: express.Application, prisma: PrismaClient) {
  app.get('/public/config', handleOssPublicConfig);
  app.get('/admin/health', (req, res) => handleAdminHealth(prisma, req, res));
  app.get('/admin/stats', (req, res) => handleAdminStats(prisma, req, res));
  app.get('/debug/rooms', (req, res) => handleDebugRooms(prisma, req, res));
}
