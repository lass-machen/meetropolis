import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import {
  handlePublicConfig,
  handleListTenants,
  handleCreateTenant,
  handleUpdateTenant,
  handleDeleteTenant,
  handlePublicTenantSignup,
} from './admin.tenants.js';
import {
  handleGetSettings,
  handleUpdateSettings,
  handleAdminHealth,
  handleAdminStats,
  handleDebugRooms,
} from './admin.system.js';
import {
  handlePublicPricingPlans,
  handleListPricingPlans,
  handleCreatePricingPlan,
  handleUpdatePricingPlan,
  handleDeletePricingPlan,
} from './admin.pricing.js';

export function registerAdminRoutes(app: express.Application, prisma: PrismaClient) {
  app.get('/public/config', (req, res) => handlePublicConfig(prisma, req, res));

  app.get('/admin/tenants', (req, res) => handleListTenants(prisma, req, res));
  app.post('/admin/tenants', (req, res) => handleCreateTenant(prisma, req, res));
  app.patch('/admin/tenants/:id', (req, res) => handleUpdateTenant(prisma, req, res));
  app.delete('/admin/tenants/:id', (req, res) => handleDeleteTenant(prisma, req, res));
  app.post('/public/tenants', (req, res) => handlePublicTenantSignup(prisma, req, res));

  app.get('/admin/settings', (req, res) => handleGetSettings(prisma, req, res));
  app.patch('/admin/settings', (req, res) => handleUpdateSettings(prisma, req, res));
  app.get('/admin/health', (req, res) => handleAdminHealth(prisma, req, res));
  app.get('/admin/stats', (req, res) => handleAdminStats(prisma, req, res));
  app.get('/debug/rooms', (req, res) => handleDebugRooms(prisma, req, res));

  app.get('/public/pricing-plans', (req, res) => handlePublicPricingPlans(prisma, req, res));
  app.get('/admin/pricing-plans', (req, res) => handleListPricingPlans(prisma, req, res));
  app.post('/admin/pricing-plans', (req, res) => handleCreatePricingPlan(prisma, req, res));
  app.patch('/admin/pricing-plans/:id', (req, res) => handleUpdatePricingPlan(prisma, req, res));
  app.delete('/admin/pricing-plans/:id', (req, res) => handleDeletePricingPlan(prisma, req, res));
}
