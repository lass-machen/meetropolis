import { useTheme } from '../theme';
import { ButtonGroup, Button, Separator } from '../buttonGroup';

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
  return (
    <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 60, display: 'flex', alignItems: 'center' }}>
      <ButtonGroup size="sm">
        <Button icon="sun" iconPosition="only" active={override === 'light'} title="Helles Design" aria-label="Helles Design" onClick={() => setOverride('light')} />
        <Button icon="moon" iconPosition="only" active={override === 'dark'} title="Dunkles Design" aria-label="Dunkles Design" onClick={() => setOverride('dark')} />
        <Button icon="desktop" iconPosition="only" active={override === 'system'} title="Systemeinstellung" aria-label="Systemeinstellung" onClick={() => setOverride('system')} />
        <Separator />
        <Button icon="gear" iconPosition="only" title="Einstellungen" aria-label="Einstellungen" onClick={onToggleMenu} />
        <Button icon="users" iconPosition="only" title="Benutzerverwaltung" aria-label="Benutzerverwaltung" onClick={onOpenUsers} />
        <Button icon="envelope" iconPosition="only" title="Einladungen" aria-label="Einladungen" onClick={onOpenInvites} />
      </ButtonGroup>
      {menuOpen && (
        <div style={{ position: 'absolute', top: 44, right: 0, background: 'rgba(17,17,20,0.96)', color: '#fff', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: 8, display: 'grid', gap: 6, minWidth: 260, boxShadow: '0 16px 40px rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}>
          <button onClick={onOpenUsers} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>Benutzer verwalten</button>
          <button onClick={onBackToWorld} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>Zurück zur Welt</button>
          <button onClick={onOpenApi} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>API-Tokens & Doku</button>
          <button onClick={onToggleEditor} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: editorActive ? 'rgba(16,185,129,0.18)' : 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>{editorActive ? 'Editor beenden' : 'Map-Editor öffnen'}</button>
          <button onClick={onLogout} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>Logout</button>
        </div>
      )}
    </div>
  );
}


