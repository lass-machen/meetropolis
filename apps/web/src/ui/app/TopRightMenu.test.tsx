import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TopRightMenu } from './TopRightMenu';
import { ThemeProvider } from '../theme';

// Same stub the other view tests use: keys pass through, and `i18n.language`
// exists (the menu's language toggle reads it).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'de', changeLanguage: () => Promise.resolve() },
  }),
}));

/**
 * The dropdown lives inside the game surface, which is `overflow: hidden`
 * (WorldMainView's `BannerAndGameLayout`). Anything past that box's bottom edge
 * is unreachable — no scrollbar, no hint, the last entries simply do not exist.
 * A15 moved that edge further up whenever a banner shows, so the menu has to
 * bound its own height and scroll instead.
 *
 * The room it may claim is the viewport below the button MINUS the dropdown's
 * own 8px offset from the button and MINUS the 76px the floating AV control bar
 * occupies at the bottom of the same view — 84px of reserve in total.
 */
describe('TopRightMenu dropdown height', () => {
  const noop = () => {};

  function anchorAt(bottom: number) {
    // jsdom has no layout: every rect is zero unless stubbed.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom,
      top: bottom - 36,
      left: 0,
      right: 0,
      width: 36,
      height: 36,
      x: 0,
      y: bottom - 36,
      toJSON: () => ({}),
    });
  }

  function renderMenu() {
    return render(
      <ThemeProvider>
        <TopRightMenu menuOpen onToggleMenu={noop} onLogout={noop} />
      </ThemeProvider>,
    );
  }

  function menuElement(): HTMLElement {
    return screen.getByRole('menu');
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bounds its height to the room below the button and scrolls the rest', () => {
    window.innerHeight = 700;
    anchorAt(100);

    renderMenu();

    // 700 viewport − 100 anchor bottom − 8 offset − 76 control-bar gutter.
    expect(menuElement().style.maxHeight).toBe('516px');
    expect(menuElement().style.overflowY).toBe('auto');
  });

  it('leaves the box that starts 8px below the button inside the viewport', () => {
    window.innerHeight = 700;
    const anchorBottom = 100;
    anchorAt(anchorBottom);

    renderMenu();

    // The dropdown's own `top` is `calc(100% + 8px)`, so its bottom edge sits at
    // anchorBottom + 8 + maxHeight. That must stay clear of the control bar.
    const maxHeight = Number.parseInt(menuElement().style.maxHeight, 10);
    expect(anchorBottom + 8 + maxHeight).toBe(700 - 76);
  });

  it('shrinks when a banner pushes the button further down', () => {
    window.innerHeight = 700;
    anchorAt(180);

    renderMenu();

    expect(menuElement().style.maxHeight).toBe('436px');
  });

  it('never collapses below a usable minimum', () => {
    window.innerHeight = 300;
    anchorAt(280);

    renderMenu();

    // 300 − 280 − 8 − 76 is negative; a scroll box of that height helps nobody.
    expect(menuElement().style.maxHeight).toBe('160px');
  });

  it('re-measures when the window is resized', () => {
    window.innerHeight = 700;
    anchorAt(100);

    renderMenu();
    expect(menuElement().style.maxHeight).toBe('516px');

    window.innerHeight = 500;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(menuElement().style.maxHeight).toBe('316px');
  });
});
