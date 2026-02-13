import React from 'react';
import { useTheme } from '../theme';
import { FAIcon } from '../FAIcon';
import { useTranslation } from 'react-i18next';

export function TopRightMenu(props: {
  menuOpen: boolean;
  onToggleMenu: () => void;
  onOpenUsers: () => void;
  onOpenInvites: () => void;
  onOpenAdmin?: () => void;
  isAdmin?: boolean;
  onBackToWorld: () => void;
  onOpenApi: () => void;
  onToggleEditor: () => void | Promise<void>;
  editorActive: boolean;
  onLogout: () => void | Promise<void>;
  onResetApp?: () => void;
  onOpenBilling?: () => void;
  onOpenProfile?: () => void;
  onOpenTenantSettings?: () => void;
  onOpenSessions?: () => void;
  onOpenPackStore?: () => void;
}) {
  const { menuOpen, onToggleMenu, onOpenUsers, onOpenInvites, onOpenAdmin, isAdmin, onBackToWorld, onOpenApi, onToggleEditor, editorActive, onLogout, onResetApp, onOpenBilling, onOpenProfile, onOpenTenantSettings, onOpenSessions, onOpenPackStore } = props;
  const { override, setOverride } = useTheme();
  const { t } = useTranslation();
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
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
      {/* Burger Menu Button */}
      <button
        onClick={onToggleMenu}
        title={t('topRightMenu.menu') || 'Menü'}
        aria-label={t('topRightMenu.menu') || 'Menü'}
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
        <FAIcon name={menuOpen ? 'xmark' : 'bars'} variant="solid" size="sm" ariaLabel="" />
      </button>

      {/* Dropdown Menu */}
      {menuOpen && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
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
          }}
        >
          {/* Theme Toggle - Inline */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
            <FAIcon name="palette" variant="solid" fixedWidth style={{ opacity: 0.6 }} />
            <span style={{ fontSize: 13, opacity: 0.8, flex: 1 }}>{t('topRightMenu.theme') || 'Theme'}</span>
            <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 6, padding: 2 }}>
              <button
                onClick={() => setOverride('light')}
                title={t('theme.light')}
                style={{
                  width: 28,
                  height: 26,
                  borderRadius: 5,
                  border: 'none',
                  background: override === 'light' ? 'rgba(255,255,255,0.2)' : 'transparent',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 12,
                }}
              >
                <FAIcon name="sun" variant="solid" size="xs" ariaLabel={t('theme.light')} />
              </button>
              <button
                onClick={() => setOverride('dark')}
                title={t('theme.dark')}
                style={{
                  width: 28,
                  height: 26,
                  borderRadius: 5,
                  border: 'none',
                  background: override === 'dark' ? 'rgba(255,255,255,0.2)' : 'transparent',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 12,
                }}
              >
                <FAIcon name="moon" variant="solid" size="xs" ariaLabel={t('theme.dark')} />
              </button>
              <button
                onClick={() => setOverride('system')}
                title={t('theme.system')}
                style={{
                  width: 28,
                  height: 26,
                  borderRadius: 5,
                  border: 'none',
                  background: override === 'system' ? 'rgba(255,255,255,0.2)' : 'transparent',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 12,
                }}
              >
                <FAIcon name="desktop" variant="solid" size="xs" ariaLabel={t('theme.system')} />
              </button>
            </div>
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 8px' }} />

          {/* Team & Management */}
          <button role="menuitem" onClick={() => handleItemClick(onOpenUsers)} className="menu-item">
            <FAIcon name="users" variant="solid" fixedWidth />
            <span>{t('topRightMenu.users')}</span>
          </button>
          <button role="menuitem" onClick={() => handleItemClick(onOpenInvites)} className="menu-item">
            <FAIcon name="envelope" variant="solid" fixedWidth />
            <span>{t('topRightMenu.invites')}</span>
          </button>
          {isAdmin && onOpenAdmin && (
            <button role="menuitem" onClick={() => handleItemClick(onOpenAdmin)} className="menu-item">
              <FAIcon name="shield" variant="solid" fixedWidth />
              <span>Admin</span>
            </button>
          )}

          <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 8px' }} />

          {/* World & Tools */}
          <button role="menuitem" onClick={() => handleItemClick(onBackToWorld)} className="menu-item">
            <FAIcon name="earth-europe" variant="solid" fixedWidth />
            <span>{t('topRightMenu.backToWorld')}</span>
          </button>
          <button role="menuitem" onClick={() => handleItemClick(onOpenApi)} className="menu-item">
            <FAIcon name="key" variant="solid" fixedWidth />
            <span>{t('topRightMenu.api')}</span>
          </button>
          <button role="menuitem" onClick={() => handleItemClick(onToggleEditor)} className={`menu-item ${editorActive ? 'active' : ''}`}>
            <FAIcon name={editorActive ? 'pen-to-square' : 'pen-ruler'} variant="solid" fixedWidth />
            <span>{editorActive ? t('topRightMenu.editorOff') : t('topRightMenu.editorOn')}</span>
          </button>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 8px' }} />

          {/* Account & Settings */}
          {onOpenProfile && (
            <button role="menuitem" onClick={() => handleItemClick(onOpenProfile)} className="menu-item">
              <FAIcon name="user-gear" variant="solid" fixedWidth />
              <span>{t('topRightMenu.profile') || 'Profile Settings'}</span>
            </button>
          )}
          {onOpenTenantSettings && (
            <button role="menuitem" onClick={() => handleItemClick(onOpenTenantSettings)} className="menu-item">
              <FAIcon name="building" variant="solid" fixedWidth />
              <span>{t('topRightMenu.orgSettings') || 'Organization'}</span>
            </button>
          )}
          {onOpenBilling && (
            <button role="menuitem" onClick={() => handleItemClick(onOpenBilling)} className="menu-item">
              <FAIcon name="credit-card" variant="solid" fixedWidth />
              <span>{t('topRightMenu.billing') || 'Billing'}</span>
            </button>
          )}
          {onOpenSessions && (
            <button role="menuitem" onClick={() => handleItemClick(onOpenSessions)} className="menu-item">
              <FAIcon name="laptop" variant="solid" fixedWidth />
              <span>{t('topRightMenu.sessions') || 'Active Sessions'}</span>
            </button>
          )}
          {onOpenPackStore && (
            <button role="menuitem" onClick={() => handleItemClick(onOpenPackStore)} className="menu-item">
              <FAIcon name="box-open" variant="solid" fixedWidth />
              <span>{t('topRightMenu.packStore') || 'Pack Store'}</span>
            </button>
          )}

          <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 8px' }} />

          {/* Logout & Reset */}
          {onResetApp && (
            <button role="menuitem" onClick={() => handleItemClick(onResetApp)} className="menu-item danger">
              <FAIcon name="broom" variant="solid" fixedWidth />
              <span>{t('topRightMenu.resetApp') || 'App zurücksetzen'}</span>
            </button>
          )}
          <button role="menuitem" onClick={() => handleItemClick(onLogout)} className="menu-item">
            <FAIcon name="right-from-bracket" variant="solid" fixedWidth />
            <span>{t('topRightMenu.logout')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
