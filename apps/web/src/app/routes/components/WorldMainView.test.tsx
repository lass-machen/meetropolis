import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BannerAndGameLayout } from './WorldMainView';

describe('BannerAndGameLayout', () => {
  // Regression test for A15: the banner slot must sit in plain document
  // flow, strictly before the header/canvas slot, and only the
  // header/canvas slot may establish its own positioning context
  // (`position: relative`). If the banner slot became positioned too (or
  // came after the header/canvas slot in the DOM), it could again end up
  // stacked above the absolutely-positioned top header bar and swallow
  // clicks on the menu button, exactly as it did before the fix.
  it('renders the banner slot before the header/canvas slot, without giving it its own positioning context', () => {
    render(
      <BannerAndGameLayout
        banners={<div data-testid="banner-slot">banner</div>}
        headerAndCanvas={<div data-testid="canvas-slot">canvas</div>}
      />,
    );

    const bannerSlot = screen.getByTestId('banner-slot');
    const canvasSlot = screen.getByTestId('canvas-slot');

    // DOM order: banner must precede the game surface.
    expect(bannerSlot.compareDocumentPosition(canvasSlot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The banner's direct wrapper stays a plain flow box.
    const bannerWrapper = bannerSlot.parentElement as HTMLElement;
    expect(bannerWrapper.style.position).toBe('');
    expect(bannerWrapper.style.zIndex).toBe('');

    // The header/canvas wrapper is the one positioned box — this is what
    // makes the top header bar's `top: 0` mean "top of the game surface"
    // rather than "top of the whole view" (see BannerAndGameLayout jsdoc).
    const canvasWrapper = canvasSlot.parentElement as HTMLElement;
    expect(canvasWrapper.style.position).toBe('relative');
  });

  it('renders an empty banner wrapper (no layout gap) when no banner is passed', () => {
    render(<BannerAndGameLayout banners={null} headerAndCanvas={<div data-testid="canvas-slot">canvas</div>} />);
    const canvasSlot = screen.getByTestId('canvas-slot');
    const canvasWrapper = canvasSlot.parentElement as HTMLElement;
    const bannerWrapper = canvasWrapper.previousElementSibling as HTMLElement;
    expect(bannerWrapper).not.toBeNull();
    expect(bannerWrapper).toBeEmptyDOMElement();
  });

  // The fullscreen participant overlay is `position: absolute; inset: 0` inside
  // the game surface, so it only covers everything if the banner row takes no
  // space. Before the A15 split it covered the banners because they shared one
  // containing block.
  it('collapses the banner row so the game surface can span the whole view', () => {
    render(
      <BannerAndGameLayout
        bannersHidden
        banners={<div data-testid="banner-slot">banner</div>}
        headerAndCanvas={<div data-testid="canvas-slot">canvas</div>}
      />,
    );

    const bannerWrapper = screen.getByTestId('banner-slot').parentElement as HTMLElement;
    expect(bannerWrapper.style.display).toBe('none');
  });

  it('keeps the banners mounted while collapsed, so their state survives', () => {
    const { rerender } = render(
      <BannerAndGameLayout
        banners={<div data-testid="banner-slot">banner</div>}
        headerAndCanvas={<div data-testid="canvas-slot">canvas</div>}
      />,
    );
    const before = screen.getByTestId('banner-slot');

    rerender(
      <BannerAndGameLayout
        bannersHidden
        banners={<div data-testid="banner-slot">banner</div>}
        headerAndCanvas={<div data-testid="canvas-slot">canvas</div>}
      />,
    );

    // Same DOM node: React kept the subtree, it was not unmounted and rebuilt.
    expect(screen.getByTestId('banner-slot')).toBe(before);
  });

  it('shows the banner row by default', () => {
    render(
      <BannerAndGameLayout
        banners={<div data-testid="banner-slot">banner</div>}
        headerAndCanvas={<div data-testid="canvas-slot">canvas</div>}
      />,
    );

    const bannerWrapper = screen.getByTestId('banner-slot').parentElement as HTMLElement;
    expect(bannerWrapper.style.display).toBe('');
  });
});
