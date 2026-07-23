import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminOverlay } from '../AdminOverlay';
import type { AdminCapabilities } from '../../../app/routes/hooks/useFetchMe';

// Mock OSS sub-panels to avoid their internal fetch calls. The enterprise
// tab is loaded via the enterpriseWebLoader and rendered through React.lazy,
// so it does not need to be mocked here; the loader returns null in tests.
vi.mock('../MapsAdmin', () => ({
  MapsAdmin: () => <div data-testid="maps-panel">MapsAdmin</div>,
}));
vi.mock('../AdminHealthDashboard', () => ({
  AdminHealthDashboard: () => <div data-testid="health-panel">Health</div>,
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
    render(<AdminOverlay apiBase="http://test" open={true} onOpenChange={() => {}} capabilities={OSS_CAPS} />);
    // OSS tabs should be present
    expect(screen.getByText('Maps')).toBeInTheDocument();
    expect(screen.getByText('System Health')).toBeInTheDocument();
    expect(screen.getByText('Einstellungen')).toBeInTheDocument();

    // Enterprise sammler-Tab should NOT be present in OSS mode
    expect(screen.queryByText('Enterprise')).not.toBeInTheDocument();
  });

  it('shows the Enterprise tab when hasBilling is true', () => {
    render(<AdminOverlay apiBase="http://test" open={true} onOpenChange={() => {}} capabilities={FULL_CAPS} />);
    expect(screen.getByText('Enterprise')).toBeInTheDocument();
    expect(screen.getByText('Maps')).toBeInTheDocument();
    expect(screen.getByText('System Health')).toBeInTheDocument();
    expect(screen.getByText('Einstellungen')).toBeInTheDocument();
  });

  it('shows the Enterprise tab when only hasAdminEnterprise is true', () => {
    render(
      <AdminOverlay
        apiBase="http://test"
        open={true}
        onOpenChange={() => {}}
        capabilities={{ hasBilling: false, hasAdminEnterprise: true, isMultiTenant: false }}
      />,
    );
    expect(screen.getByText('Enterprise')).toBeInTheDocument();
  });

  it('does not show the Enterprise tab when only isMultiTenant is true (without billing/admin caps)', () => {
    render(
      <AdminOverlay
        apiBase="http://test"
        open={true}
        onOpenChange={() => {}}
        capabilities={{ hasBilling: false, hasAdminEnterprise: false, isMultiTenant: true }}
      />,
    );
    expect(screen.queryByText('Enterprise')).not.toBeInTheDocument();
  });
});
