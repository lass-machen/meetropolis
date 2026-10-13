// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getEnterpriseWebModule = vi.hoisted(() => vi.fn());

vi.mock('../../lib/enterpriseWebLoader', () => ({ getEnterpriseWebModule }));
vi.mock('./WorldScreen', () => ({ WorldScreen: () => <div data-testid="world" /> }));

import type { ComponentType } from 'react';
import { ConnectRoute } from './ConnectRoute';
import type { AgentConnectPageProps } from '../../lib/enterpriseWebLoader';

afterEach(() => {
  cleanup();
  window.location.hash = '';
  vi.clearAllMocks();
});

describe('ConnectRoute', () => {
  beforeEach(() => {
    window.location.hash = '#/connect?request=abc_-1';
  });

  it('renders the AgentConnectPage slot with the request id', async () => {
    const Page = ({ requestId }: AgentConnectPageProps) => <div>{`slot:${requestId ?? 'none'}`}</div>;
    getEnterpriseWebModule.mockResolvedValue({ AgentConnectPage: Page });

    render(<ConnectRoute requestId="abc_-1" />);

    expect(await screen.findByText('slot:abc_-1')).toBeTruthy();
  });

  it('renders the unknown-route fallback when the slot is absent', async () => {
    getEnterpriseWebModule.mockResolvedValue(null);

    render(<ConnectRoute requestId="abc_-1" />);

    expect(await screen.findByTestId('world')).toBeTruthy();
  });

  it('sends login back to the current connect hash', async () => {
    const Page = ({ onRequireLogin }: AgentConnectPageProps) => (
      <button type="button" onClick={onRequireLogin}>
        login
      </button>
    );
    getEnterpriseWebModule.mockResolvedValue({ AgentConnectPage: Page });

    render(<ConnectRoute requestId="abc_-1" />);
    fireEvent.click(await screen.findByText('login'));

    expect(window.location.hash).toBe('#/login?next=' + encodeURIComponent('#/connect?request=abc_-1'));
  });

  it('shows the loading placeholder until the loader settles', async () => {
    let resolveMod: (value: { AgentConnectPage: ComponentType<AgentConnectPageProps> }) => void = () => undefined;
    getEnterpriseWebModule.mockReturnValue(
      new Promise<{ AgentConnectPage: ComponentType<AgentConnectPageProps> }>((resolve) => {
        resolveMod = resolve;
      }),
    );
    const Page = () => <div>slot</div>;

    render(<ConnectRoute requestId={null} />);
    expect(screen.getByText('Loading…')).toBeTruthy();

    resolveMod({ AgentConnectPage: Page });
    expect(await screen.findByText('slot')).toBeTruthy();
  });
});
