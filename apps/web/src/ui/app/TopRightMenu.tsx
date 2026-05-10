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

function ThemeToggle({ override, setOverride, label }: { override: string; setOverride: (v: 'light' | 'dark' | 'system') => void; label: string }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
      <Icon name="palette" style={{ opacity: 0.6 }} />
      <span style={{ fontSize: 13, opacity: 0.8, flex: 1 }}>{label}</span>
      <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 6, padding: 2 }}>
        <button onClick={() => setOverride('light')} title={t('theme.light')} style={{ ...SEGMENT_BTN_BASE, background: override === 'light' ? 'rgba(255,255,255,0.2)' : 'transparent', fontSize: 12 }}>
          <Icon name="sun" size="xs" ariaLabel={t('theme.light')} />
        </button>
        <button onClick={() => setOverride('dark')} title={t('theme.dark')} style={{ ...SEGMENT_BTN_BASE, background: override === 'dark' ? 'rgba(255,255,255,0.2)' : 'transparent', fontSize: 12 }}>
          <Icon name="moon" size="xs" ariaLabel={t('theme.dark')} />
        </button>
        <button onClick={() => setOverride('system')} title={t('theme.system')} style={{ ...SEGMENT_BTN_BASE, background: override === 'system' ? 'rgba(255,255,255,0.2)' : 'transparent', fontSize: 12 }}>
          <Icon name="monitor" size="xs" ariaLabel={t('theme.system')} />
        </button>
      </div>
    </div>
  );
}

function LanguageToggle({ language, changeLanguage, label }: { language: string; changeLanguage: (l: string) => void; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
      <Icon name="globe" style={{ opacity: 0.6 }} />
      <span style={{ fontSize: 13, opacity: 0.8, flex: 1 }}>{label}</span>
      <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 6, padding: 2 }}>
        <button onClick={() => changeLanguage('de')} title="Deutsch" style={{ ...SEGMENT_BTN_BASE, background: language.startsWith('de') ? 'rgba(255,255,255,0.2)' : 'transparent', fontSize: 11, fontWeight: language.startsWith('de') ? 700 : 500 }}>DE</button>
        <button onClick={() => changeLanguage('en')} title="English" style={{ ...SEGMENT_BTN_BASE, background: language.startsWith('en') ? 'rgba(255,255,255,0.2)' : 'transparent', fontSize: 11, fontWeight: language.startsWith('en') ? 700 : 500 }}>EN</button>
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick, className }: { icon: IconName; label: string; onClick: () => void; className?: string }) {
  return (
    <button role="menuitem" onClick={onClick} className={className || 'menu-item'}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}

function TeamSection({ props, handleItemClick, t }: { props: TopRightMenuProps; handleItemClick: (a: () => void | Promise<void>) => void; t: (k: string) => string }) {
  const { onOpenUsers, onOpenInvites, onOpenAdmin, isAdmin } = props;
  const hasAny = !!(onOpenUsers || onOpenInvites || (isAdmin && onOpenAdmin));
  return (
    <>
      {onOpenUsers && <MenuItem icon="users" label={t('topRightMenu.users')} onClick={() => handleItemClick(onOpenUsers)} />}
      {onOpenInvites && <MenuItem icon="mail" label={t('topRightMenu.invites')} onClick={() => handleItemClick(onOpenInvites)} />}
      {isAdmin && onOpenAdmin && <MenuItem icon="shield" label="Admin" onClick={() => handleItemClick(onOpenAdmin)} />}
      {hasAny && <div style={DIVIDER} />}
    </>
  );
}

function AccountSection({ props, handleItemClick, t }: { props: TopRightMenuProps; handleItemClick: (a: () => void | Promise<void>) => void; t: (k: string) => string }) {
  const { onOpenProfile, onOpenTenantSettings, onOpenBilling, onOpenSessions, onOpenPackStore } = props;
  return (
    <>
      {onOpenProfile && <MenuItem icon="user-cog" label={t('topRightMenu.profile') || 'Profile Settings'} onClick={() => handleItemClick(onOpenProfile)} />}
      {onOpenTenantSettings && <MenuItem icon="building" label={t('topRightMenu.orgSettings') || 'Organization'} onClick={() => handleItemClick(onOpenTenantSettings)} />}
      {onOpenBilling && <MenuItem icon="credit-card" label={t('topRightMenu.billing') || 'Billing'} onClick={() => handleItemClick(onOpenBilling)} />}
      {onOpenSessions && <MenuItem icon="laptop" label={t('topRightMenu.sessions') || 'Active Sessions'} onClick={() => handleItemClick(onOpenSessions)} />}
      {onOpenPackStore && <MenuItem icon="package-open" label={t('topRightMenu.packStore') || 'Pack Store'} onClick={() => handleItemClick(onOpenPackStore)} />}
    </>
  );
}

function MenuContent({ props, handleItemClick }: { props: TopRightMenuProps; handleItemClick: (a: () => void | Promise<void>) => void }) {
  const { override, setOverride } = useTheme();
  const { t, i18n } = useTranslation();
  const { onToggleEditor, editorActive, onResetApp, onLogout } = props;

  return (
    <div role="menu" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, background: 'rgba(17,17,20,0.96)', color: '#fff', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: 10, display: 'grid', gap: 4, minWidth: 220, boxShadow: '0 16px 40px rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', zIndex: 70 }}>
      <ThemeToggle override={override} setOverride={setOverride} label={t('topRightMenu.theme') || 'Theme'} />
      <LanguageToggle language={i18n.language} changeLanguage={(l) => i18n.changeLanguage(l)} label={t('topRightMenu.language') || 'Language'} />
      <div style={DIVIDER} />
      <TeamSection props={props} handleItemClick={handleItemClick} t={t} />
      {onToggleEditor && (
        <button role="menuitem" onClick={() => handleItemClick(onToggleEditor)} className={`menu-item ${editorActive ? 'active' : ''}`}>
          <Icon name={editorActive ? 'pen-square' : 'pen-ruler'} />
          <span>{editorActive ? t('topRightMenu.editorOff') : t('topRightMenu.editorOn')}</span>
        </button>
      )}
      <div style={DIVIDER} />
      <AccountSection props={props} handleItemClick={handleItemClick} t={t} />
      <div style={DIVIDER} />
      {onResetApp && <MenuItem icon="reset" label={t('topRightMenu.resetApp') || 'App zurücksetzen'} onClick={() => handleItemClick(onResetApp)} className="menu-item danger" />}
      <MenuItem icon="logout" label={t('topRightMenu.logout')} onClick={() => handleItemClick(onLogout)} />
    </div>
  );
}

export function TopRightMenu(props: TopRightMenuProps) {
  const { menuOpen, onToggleMenu } = props;
  const { t } = useTranslation();
  const menuRef = React.useRef<HTMLDivElement>(null);

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
    action();
  };

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={onToggleMenu}
        title={t('topRightMenu.menu') || 'Menü'}
        aria-label={t('topRightMenu.menu') || 'Menü'}
        aria-expanded={menuOpen}
        style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 10, border: '1px solid var(--border)', background: menuOpen ? 'var(--bg-btn-active)' : 'var(--bg-btn-bg)', color: 'var(--fg)', cursor: 'pointer', transition: 'background 0.15s ease' }}
      >
        <Icon name={menuOpen ? 'xmark' : 'menu'} size="sm" ariaLabel="" />
      </button>
      {menuOpen && <MenuContent props={props} handleItemClick={handleItemClick} />}
    </div>
  );
}
