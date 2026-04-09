import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminOverlay } from '../AdminOverlay';
import type { AdminCapabilities } from '../../../app/routes/hooks/useFetchMe';

// Mock all admin sub-panels to avoid their internal fetch calls
vi.mock('../TenantsAdmin', () => ({
  TenantsAdmin: () => <div data-testid="tenants-panel">TenantsAdmin</div>,
}));
vi.mock('../BillingAdmin', () => ({
  BillingAdmin: () => <div data-testid="billing-panel">BillingAdmin</div>,
}));
vi.mock('../PackCatalogAdmin', () => ({
  PackCatalogAdmin: () => <div data-testid="packs-panel">PackCatalogAdmin</div>,
}));
vi.mock('../MapsAdmin', () => ({
  MapsAdmin: () => <div data-testid="maps-panel">MapsAdmin</div>,
}));
vi.mock('../AdminHealthDashboard', () => ({
  AdminHealthDashboard: () => <div data-testid="health-panel">Health</div>,
}));
vi.mock('../AuditLogAdmin', () => ({
  AuditLogAdmin: () => <div data-testid="audit-panel">AuditLogAdmin</div>,
}));
vi.mock('../SettingsAdmin', () => ({
  SettingsAdmin: () => <div data-testid="settings-panel">SettingsAdmin</div>,
}));

const OSS_CAPS: AdminCapabilities = {
  hasBilling: false,
  hasAdminEnterprise: false,
  isMultiTenant: false,
};

const FULL_CAPS: AdminCapabilities = {
  hasBilling: true,
  hasAdminEnterprise: true,
  isMultiTenant: true,
};

describe('AdminOverlay', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows only OSS tabs when all capabilities are false', () => {
    render(
      <AdminOverlay
        apiBase="http://test"
        open={true}
        onOpenChange={() => {}}
        capabilities={OSS_CAPS}
      />,
    );
    // OSS tabs should be present
    expect(screen.getByText('Mandanten')).toBeInTheDocument();
    expect(screen.getByText('Maps')).toBeInTheDocument();
    expect(screen.getByText('System Health')).toBeInTheDocument();
    expect(screen.getByText('Einstellungen')).toBeInTheDocument();

    // Enterprise tabs should NOT be present
    expect(screen.queryByText('Pakete & Billing')).not.toBeInTheDocument();
    expect(screen.queryByText('Pack Catalog')).not.toBeInTheDocument();
    expect(screen.queryByText('Audit Log')).not.toBeInTheDocument();
  });

  it('shows all tabs when all capabilities are true', () => {
    render(
      <AdminOverlay
        apiBase="http://test"
        open={true}
        onOpenChange={() => {}}
        capabilities={FULL_CAPS}
      />,
    );
    // All tabs should be present
    expect(screen.getByText('Mandanten')).toBeInTheDocument();
    expect(screen.getByText('Pakete & Billing')).toBeInTheDocument();
    expect(screen.getByText('Pack Catalog')).toBeInTheDocument();
    expect(screen.getByText('Maps')).toBeInTheDocument();
    expect(screen.getByText('System Health')).toBeInTheDocument();
    expect(screen.getByText('Audit Log')).toBeInTheDocument();
    expect(screen.getByText('Einstellungen')).toBeInTheDocument();
  });

  it('shows billing tabs but not packs when only hasBilling is true', () => {
    render(
      <AdminOverlay
        apiBase="http://test"
        open={true}
        onOpenChange={() => {}}
        capabilities={{ hasBilling: true, hasAdminEnterprise: false, isMultiTenant: false }}
      />,
    );
    expect(screen.getByText('Pakete & Billing')).toBeInTheDocument();
    expect(screen.getByText('Audit Log')).toBeInTheDocument();
    expect(screen.queryByText('Pack Catalog')).not.toBeInTheDocument();
  });

  it('shows packs tab but not billing tabs when only hasAdminEnterprise is true', () => {
    render(
      <AdminOverlay
        apiBase="http://test"
        open={true}
        onOpenChange={() => {}}
        capabilities={{ hasBilling: false, hasAdminEnterprise: true, isMultiTenant: false }}
      />,
    );
    expect(screen.getByText('Pack Catalog')).toBeInTheDocument();
    expect(screen.queryByText('Pakete & Billing')).not.toBeInTheDocument();
    expect(screen.queryByText('Audit Log')).not.toBeInTheDocument();
  });
});
