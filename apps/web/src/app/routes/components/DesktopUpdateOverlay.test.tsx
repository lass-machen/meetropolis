import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DesktopUpdateOverlay } from './DesktopUpdateOverlay';
import { useDesktop, type DesktopState } from '../hooks/useDesktop';
import type { DesktopModule } from '../../../lib/desktopLoader';

vi.mock('../hooks/useDesktop', () => ({ useDesktop: vi.fn() }));

function stubModule(): DesktopModule {
  return {
    initDesktop: () => {},
    waitForConfig: async () => {},
    MiniModeView: () => null,
    TauriPreferencesModal: () => null,
    UpdateBanner: () => <div data-testid="update-banner">banner</div>,
    openExternal: async () => {},
    setDesktopAuthToken: () => {},
  };
}

function desktopState(desktop: DesktopModule | null): DesktopState {
  return {
    isTauri: desktop !== null,
    isMiniMode: false,
    toggleMiniMode: async () => {},
    desktop,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DesktopUpdateOverlay', () => {
  it('renders the update banner whenever the desktop module is present', () => {
    // No auth context is provided: the overlay must render the banner purely
    // from the desktop module, which is what lets it work on the login screen.
    vi.mocked(useDesktop).mockReturnValue(desktopState(stubModule()));
    const { getByTestId } = render(<DesktopUpdateOverlay />);
    expect(getByTestId('update-banner')).toBeInTheDocument();
  });

  it('renders nothing in the OSS build where no desktop module loads', () => {
    vi.mocked(useDesktop).mockReturnValue(desktopState(null));
    const { queryByTestId } = render(<DesktopUpdateOverlay />);
    expect(queryByTestId('update-banner')).toBeNull();
  });

  it('renders nothing when the module lacks an UpdateBanner export', () => {
    const partial = { ...stubModule(), UpdateBanner: undefined as unknown as DesktopModule['UpdateBanner'] };
    vi.mocked(useDesktop).mockReturnValue(desktopState(partial));
    const { container } = render(<DesktopUpdateOverlay />);
    expect(container).toBeEmptyDOMElement();
  });
});
