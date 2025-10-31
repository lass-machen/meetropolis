import { ThemeToggleButton } from '../theme';
import { FAIcon } from '../FAIcon';

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
  return (
    <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 60, display: 'flex', alignItems: 'center', gap: 8 }}>
      <ThemeToggleButton />
      <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.12)' }} />
      <button onClick={onToggleMenu} title="Einstellungen" style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--glass)', cursor: 'pointer' }}>
        <span className="sr-only">Einstellungen</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 8a4 4 0 100 8 4 4 0 000-8z" stroke="#fff" strokeWidth="1.5"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c0 .66.39 1.26 1 1.51.16.07.33.1.51.1H21a2 2 0 110 4h-.09c-.18 0-.35.03-.51.1-.61.25-1 .85-1 1.51z" stroke="#fff" strokeWidth="1.2"/></svg>
      </button>
      <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.12)' }} />
      <button onClick={onOpenUsers} title="Benutzerverwaltung" style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--glass)', cursor: 'pointer' }}>
        <FAIcon name="users" title="Benutzer" />
      </button>
      <button onClick={onOpenInvites} title="Einladungen" style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--glass)', cursor: 'pointer' }}>
        <FAIcon name="envelope" title="Einladungen" />
      </button>
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


