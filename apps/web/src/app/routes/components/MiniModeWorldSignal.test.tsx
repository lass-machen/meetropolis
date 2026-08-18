import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MiniModeWorldSignal } from './MiniModeWorldSignal';
import { useMiniModeAuthGuard } from '../hooks/useMiniModeAuthGuard';

vi.mock('../hooks/useMiniModeAuthGuard', () => ({ useMiniModeAuthGuard: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MiniModeWorldSignal', () => {
  it('reports the world for as long as it is mounted', () => {
    // WorldApp renders this behind its auth gate, so being mounted *is* the
    // statement "the world is on screen". Reporting anything else here would
    // shrink or expand the window against the user's own choice.
    const { container } = render(<MiniModeWorldSignal />);
    expect(vi.mocked(useMiniModeAuthGuard)).toHaveBeenCalledWith('world');
    expect(container).toBeEmptyDOMElement();
  });
});
