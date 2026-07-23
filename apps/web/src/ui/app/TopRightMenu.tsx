import React from 'react';
import { useTheme } from '../theme';
import { Icon, type IconName } from '../Icon';
import { useTranslation } from 'react-i18next';

type TopRightMenuProps = {
  menuOpen: boolean;
  onToggleMenu: () => void;
  onOpenUsers?: () => void;
  onOpenInvites?: () => void;
  onOpenAdmin?: () => void;
  isAdmin?: boolean;
  onBackToWorld?: () => void;
  onOpenApi?: () => void;
  onToggleEditor?: () => void | Promise<void>;
  editorActive?: boolean;
  onLogout: () => void | Promise<void>;
  onResetApp?: () => void;
  onOpenBilling?: () => void;
  onOpenProfile?: () => void;
  onOpenTenantSettings?: () => void;
  onOpenSessions?: () => void;
  onOpenPackStore?: () => void;
};

const SEGMENT_BTN_BASE: React.CSSProperties = {
  width: 28,
  height: 26,
  borderRadius: 5,
  border: 'none',
  color: '#fff',
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center',
};
const DIVIDER: React.CSSProperties = { height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 8px' };

function ThemeToggle({
  override,
  setOverride,
  label,
}: {
  override: string;
  setOverride: (v: 'light' | 'dark' | 'system') => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
      <Icon name="palette" style={{ opacity: 0.6 }} />
      <span style={{ fontSize: 13, opacity: 0.8, flex: 1 }}>{label}</span>
      <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 6, padding: 2 }}>
        <button
          onClick={() => setOverride('light')}
          title={t('theme.light')}
          style={{
            ...SEGMENT_BTN_BASE,
            background: override === 'light' ? 'rgba(255,255,255,0.2)' : 'transparent',
            fontSize: 12,
          }}
        >
          <Icon name="sun" size="xs" ariaLabel={t('theme.light')} />
        </button>
        <button
          onClick={() => setOverride('dark')}
          title={t('theme.dark')}
          style={{
            ...SEGMENT_BTN_BASE,
            background: override === 'dark' ? 'rgba(255,255,255,0.2)' : 'transparent',
            fontSize: 12,
          }}
        >
          <Icon name="moon" size="xs" ariaLabel={t('theme.dark')} />
        </button>
        <button
          onClick={() => setOverride('system')}
          title={t('theme.system')}
          style={{
            ...SEGMENT_BTN_BASE,
            background: override === 'system' ? 'rgba(255,255,255,0.2)' : 'transparent',
            fontSize: 12,
          }}
        >
          <Icon name="monitor" size="xs" ariaLabel={t('theme.system')} />
        </button>
      </div>
    </div>
  );
}

function LanguageToggle({
  language,
  changeLanguage,
  label,
}: {
  language: string;
  changeLanguage: (l: string) => void;
  label: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
      <Icon name="globe" style={{ opacity: 0.6 }} />
      <span style={{ fontSize: 13, opacity: 0.8, flex: 1 }}>{label}</span>
      <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 6, padding: 2 }}>
        <button
          onClick={() => changeLanguage('de')}
          title="Deutsch"
          style={{
            ...SEGMENT_BTN_BASE,
            background: language.startsWith('de') ? 'rgba(255,255,255,0.2)' : 'transparent',
            fontSize: 11,
            fontWeight: language.startsWith('de') ? 700 : 500,
          }}
        >
          DE
        </button>
        <button
          onClick={() => changeLanguage('en')}
          title="English"
          style={{
            ...SEGMENT_BTN_BASE,
            background: language.startsWith('en') ? 'rgba(255,255,255,0.2)' : 'transparent',
            fontSize: 11,
            fontWeight: language.startsWith('en') ? 700 : 500,
          }}
        >
          EN
        </button>
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  className,
  hint,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  className?: string;
  /** Small dimmed note after the label, e.g. "Coming soon". */
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled}
      className={className || 'menu-item'}
      style={disabled ? { opacity: 0.5, cursor: 'default' } : undefined}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {hint && <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.6 }}>{hint}</span>}
    </button>
  );
}

function TeamSection({
  props,
  handleItemClick,
  t,
}: {
  props: TopRightMenuProps;
  handleItemClick: (a: () => void | Promise<void>) => void;
  t: (k: string) => string;
}) {
  const { onOpenUsers, onOpenInvites, onOpenAdmin, isAdmin } = props;
  const hasAny = !!(onOpenUsers || onOpenInvites || (isAdmin && onOpenAdmin));
  return (
    <>
      {onOpenUsers && (
        <MenuItem icon="users" label={t('topRightMenu.users')} onClick={() => handleItemClick(onOpenUsers)} />
      )}
      {onOpenInvites && (
        <MenuItem icon="mail" label={t('topRightMenu.invites')} onClick={() => handleItemClick(onOpenInvites)} />
      )}
      {isAdmin && onOpenAdmin && <MenuItem icon="shield" label="Admin" onClick={() => handleItemClick(onOpenAdmin)} />}
      {hasAny && <div style={DIVIDER} />}
    </>
  );
}

function AccountSection({
  props,
  handleItemClick,
  t,
}: {
  props: TopRightMenuProps;
  handleItemClick: (a: () => void | Promise<void>) => void;
  t: (k: string) => string;
}) {
  const { onOpenProfile, onOpenTenantSettings, onOpenBilling, onOpenSessions, onOpenPackStore } = props;
  return (
    <>
      {onOpenProfile && (
        <MenuItem
          icon="user-cog"
          label={t('topRightMenu.profile') || 'Profile Settings'}
          onClick={() => handleItemClick(onOpenProfile)}
        />
      )}
      {onOpenTenantSettings && (
        <MenuItem
          icon="building"
          label={t('topRightMenu.orgSettings') || 'Organization'}
          onClick={() => handleItemClick(onOpenTenantSettings)}
        />
      )}
      {onOpenBilling && (
        <MenuItem
          icon="credit-card"
          label={t('topRightMenu.billing') || 'Billing'}
          onClick={() => handleItemClick(onOpenBilling)}
        />
      )}
      {onOpenSessions && (
        <MenuItem
          icon="laptop"
          label={t('topRightMenu.sessions') || 'Active Sessions'}
          onClick={() => handleItemClick(onOpenSessions)}
        />
      )}
      {onOpenPackStore && (
        <MenuItem
          icon="package-open"
          label={t('topRightMenu.packStore') || 'Pack Store'}
          hint={t('topRightMenu.comingSoon') || 'Coming soon'}
          disabled
          onClick={() => handleItemClick(onOpenPackStore)}
        />
      )}
    </>
  );
}

function MenuContent({
  props,
  handleItemClick,
  maxHeight,
}: {
  props: TopRightMenuProps;
  handleItemClick: (a: () => void | Promise<void>) => void;
  /**
   * Room left below the button, in px — already net of the dropdown's own
   * offset and of the space the AV control bar occupies. See
   * {@link useDropdownMaxHeight}.
   */
  maxHeight: number | null;
}) {
  const { override, setOverride } = useTheme();
  const { t, i18n } = useTranslation();
  const { onToggleEditor, editorActive, onResetApp, onLogout } = props;

  return (
    <div
      role="menu"
      style={{
        position: 'absolute',
        // Same constant the height calculation subtracts (see
        // {@link useDropdownMaxHeight}); hard-coding it twice is how the two
        // silently disagreed.
        top: `calc(100% + ${DROPDOWN_OFFSET}px)`,
        right: 0,
        background: 'rgba(17,17,20,0.96)',
        color: '#fff',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 12,
        padding: 10,
        display: 'grid',
        gap: 4,
        minWidth: 220,
        boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(8px)',
        zIndex: 70,
        // Scroll instead of being clipped. The dropdown sits inside an ancestor
        // with `overflow: hidden` (the game surface), so anything past that
        // ancestor's bottom edge is simply not reachable — no scrollbar, no
        // hint, the last entries (reset, logout) just do not exist. That edge
        // moved up once a banner started pushing the header bar down (A15), and
        // it moves again on a short viewport, so the height has to follow the
        // available room rather than a fixed guess.
        ...(maxHeight != null ? { maxHeight, overflowY: 'auto' as const } : {}),
      }}
    >
      <ThemeToggle override={override} setOverride={setOverride} label={t('topRightMenu.theme') || 'Theme'} />
      <LanguageToggle
        language={i18n.language}
        changeLanguage={(l) => {
          void i18n.changeLanguage(l);
        }}
        label={t('topRightMenu.language') || 'Language'}
      />
      <div style={DIVIDER} />
      <TeamSection props={props} handleItemClick={handleItemClick} t={t} />
      {onToggleEditor && (
        <button
          role="menuitem"
          onClick={() => handleItemClick(onToggleEditor)}
          className={`menu-item ${editorActive ? 'active' : ''}`}
        >
          <Icon name={editorActive ? 'pen-square' : 'pen-ruler'} />
          <span>{editorActive ? t('topRightMenu.editorOff') : t('topRightMenu.editorOn')}</span>
        </button>
      )}
      <div style={DIVIDER} />
      <AccountSection props={props} handleItemClick={handleItemClick} t={t} />
      <div style={DIVIDER} />
      {onResetApp && (
        <MenuItem
          icon="reset"
          label={t('topRightMenu.resetApp')}
          onClick={() => handleItemClick(onResetApp)}
          className="menu-item danger"
        />
      )}
      <MenuItem icon="logout" label={t('topRightMenu.logout')} onClick={() => handleItemClick(onLogout)} />
    </div>
  );
}

/**
 * Vertical distance between the anchor button's bottom edge and the dropdown's
 * top edge. Shared with the dropdown's own `top` so the two cannot drift apart:
 * every pixel of this offset is room the dropdown does NOT have.
 */
const DROPDOWN_OFFSET = 8;
/**
 * Space kept free at the bottom of the view, in px.
 *
 * Not just cosmetic breathing room: the AV control bar floats over the bottom of
 * the same view (`AVControlBar`, `position: absolute; bottom: 16`), and the game
 * surface that clips the dropdown shares its bottom edge with it — so measuring
 * against the viewport alone would let a fully expanded admin menu run underneath
 * the bar's buttons. The reserve is that bar: 16px offset + 52px height (a `md`
 * button group: 32px items plus 2 × 10px container padding, see theme.css) plus
 * a few px of gap. `MapSwitcher` parks itself at `bottom: 70` for the same
 * reason, which is the corroborating second opinion on the number.
 *
 * Reserved unconditionally, including while the editor hides the bar: making it
 * conditional would tie this menu to another component's render state for at
 * most 76px of extra room, and `DROPDOWN_MIN_HEIGHT` already covers the short
 * viewports where that room would matter.
 */
const DROPDOWN_BOTTOM_GUTTER = 76;
/** Never collapse the menu below this; scrolling a tiny box is worse than overflowing. */
const DROPDOWN_MIN_HEIGHT = 160;

/**
 * Vertical room available to the dropdown, measured from the anchor button.
 *
 * Measured rather than assumed: the button's distance from the top of the
 * viewport depends on whether a banner is showing above the game surface
 * (WorldMainView's `BannerAndGameLayout`), so a fixed `max-height` would be
 * wrong in one of the two states. Re-measured on open and on resize; `null`
 * before the first measurement, which leaves the dropdown unconstrained (the
 * pre-existing behaviour) rather than briefly clamping it to a guess.
 *
 * The dropdown starts `DROPDOWN_OFFSET` below the anchor, so that offset is
 * subtracted as well — otherwise the computed max-height would exceed the real
 * room by exactly those pixels.
 */
function useDropdownMaxHeight(anchorRef: React.RefObject<HTMLDivElement | null>, open: boolean): number | null {
  const [maxHeight, setMaxHeight] = React.useState<number | null>(null);

  React.useLayoutEffect(() => {
    if (!open) {
      setMaxHeight(null);
      return;
    }
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const anchorBottom = el.getBoundingClientRect().bottom;
      const room = window.innerHeight - anchorBottom - DROPDOWN_OFFSET - DROPDOWN_BOTTOM_GUTTER;
      setMaxHeight(Math.max(DROPDOWN_MIN_HEIGHT, Math.round(room)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchorRef, open]);

  return maxHeight;
}

export function TopRightMenu(props: TopRightMenuProps) {
  const { menuOpen, onToggleMenu } = props;
  const { t } = useTranslation();
  const menuRef = React.useRef<HTMLDivElement>(null);
  const dropdownMaxHeight = useDropdownMaxHeight(menuRef, menuOpen);

  React.useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onToggleMenu();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen, onToggleMenu]);

  const handleItemClick = (action: () => void | Promise<void>) => {
    onToggleMenu();
    void action();
  };

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={onToggleMenu}
        title={t('topRightMenu.menu')}
        aria-label={t('topRightMenu.menu')}
        aria-expanded={menuOpen}
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 36,
          height: 36,
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: menuOpen ? 'var(--bg-btn-active)' : 'var(--bg-btn-bg)',
          color: 'var(--fg)',
          cursor: 'pointer',
          transition: 'background 0.15s ease',
        }}
      >
        <Icon name={menuOpen ? 'xmark' : 'menu'} size="sm" ariaLabel="" />
      </button>
      {menuOpen && <MenuContent props={props} handleItemClick={handleItemClick} maxHeight={dropdownMaxHeight} />}
    </div>
  );
}
