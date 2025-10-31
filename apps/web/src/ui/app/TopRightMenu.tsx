import { useTheme } from '../theme';
import { ButtonGroup, Button, Separator } from '../buttonGroup';
import { FAIcon } from '../FAIcon';
import { useTranslation } from 'react-i18next';

export function TopRightMenu(props: {
  menuOpen: boolean;
  onToggleMenu: () => void;
  onOpenUsers: () => void;
  onOpenInvites: () => void;
  onBackToWorld: () => void;
  onOpenApi: () => void;
  onToggleEditor: () => void | Promise<void>;
  editorActive: boolean;
  onLogout: () => void | Promise<void>;
}) {
  const { menuOpen, onToggleMenu, onOpenUsers, onOpenInvites, onBackToWorld, onOpenApi, onToggleEditor, editorActive, onLogout } = props;
  const { override, setOverride } = useTheme();
  const { t } = useTranslation();
  return (
    <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 60, display: 'flex', alignItems: 'center' }}>
      <ButtonGroup size="sm">
        <Button icon="sun" iconPosition="only" active={override === 'light'} title={t('theme.light')} aria-label={t('theme.light')} onClick={() => setOverride('light')} />
        <Button icon="moon" iconPosition="only" active={override === 'dark'} title={t('theme.dark')} aria-label={t('theme.dark')} onClick={() => setOverride('dark')} />
        <Button icon="desktop" iconPosition="only" active={override === 'system'} title={t('theme.system')} aria-label={t('theme.system')} onClick={() => setOverride('system')} />
        <Separator style={{ margin: '0 8px' }} />
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <Button icon="gear" iconPosition="only" title={t('topRightMenu.settings')} aria-label={t('topRightMenu.settings')} onClick={onToggleMenu} />
          {menuOpen && (
            <div role="menu" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, background: 'rgba(17,17,20,0.96)', color: '#fff', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: 10, display: 'grid', gap: 8, minWidth: 280, boxShadow: '0 16px 40px rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', zIndex: 70 }}>
              <button role="menuitem" onClick={onBackToWorld} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer', display:'flex', alignItems:'center', gap:8 }}>
                <FAIcon name="earth-europe" variant="solid" fixedWidth />
                <span>{t('topRightMenu.backToWorld')}</span>
              </button>
              
              <button role="menuitem" onClick={onOpenApi} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer', display:'flex', alignItems:'center', gap:8 }}>
                <FAIcon name="key" variant="solid" fixedWidth />
                <span>{t('topRightMenu.api')}</span>
              </button>
              <button role="menuitem" onClick={onToggleEditor} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: editorActive ? 'rgba(16,185,129,0.18)' : 'var(--glass)', color: 'var(--fg)', cursor: 'pointer', display:'flex', alignItems:'center', gap:8 }}>
                <FAIcon name={editorActive ? 'pen-to-square' : 'pen-ruler'} variant="solid" fixedWidth />
                <span>{editorActive ? t('topRightMenu.editorOff') : t('topRightMenu.editorOn')}</span>
              </button>
              <div style={{ height: 1, background: 'var(--border)', margin: '6px 4px' }} />
              <button role="menuitem" onClick={onLogout} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer', display:'flex', alignItems:'center', gap:8 }}>
                <FAIcon name="right-from-bracket" variant="solid" fixedWidth />
                <span>{t('topRightMenu.logout')}</span>
              </button>
            </div>
          )}
        </div>
        <Button icon="users" iconPosition="only" title={t('topRightMenu.users')} aria-label={t('topRightMenu.users')} onClick={onOpenUsers} />
        <Button icon="envelope" iconPosition="only" title={t('topRightMenu.invites')} aria-label={t('topRightMenu.invites')} onClick={onOpenInvites} />
      </ButtonGroup>
    </div>
  );
}


