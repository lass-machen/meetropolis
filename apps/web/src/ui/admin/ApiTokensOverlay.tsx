import { Modal } from '../system/Modal';
import { useEffect } from 'react';

export function ApiTokensOverlay(props: {
  open: boolean;
  onClose: () => void;
  apiBase: string;
  apiTokens: Array<{ id: string; name?: string | null; createdAt: string; lastUsedAt?: string | null }>;
  setApiTokens: (v: Array<{ id: string; name?: string | null; createdAt: string; lastUsedAt?: string | null }>) => void;
  newTokenName: string;
  setNewTokenName: (v: string) => void;
  freshToken: string | null;
  setFreshToken: (v: string | null) => void;
}) {
  const { open, onClose, apiBase, apiTokens, setApiTokens, newTokenName, setNewTokenName, freshToken, setFreshToken } = props;

  useEffect(() => {
    if (open) {
      fetch(`${apiBase}/api-tokens`, { credentials:'include' })
        .then(r => r.json())
        .then(list => setApiTokens(list));
    }
  }, [open, apiBase, setApiTokens]);

  return (
    <Modal open={open} onOpenChange={(o)=>{ if(!o) onClose(); }} title="API-Zugriff">
      <div style={{ display:'grid', gap: 10 }}>
        <div style={{ fontSize: 13, color: '#e5e7eb' }}>Mit persönlichen Tokens kannst du dein Mikro, Kamera, Screenshare und den Nicht-stören-Modus remote steuern – solange du online bist.</div>
        <div style={{ display:'flex', gap: 12, alignItems:'center' }}>
          <input value={newTokenName} onChange={e=>setNewTokenName(e.target.value)} placeholder="Token-Name (optional)" style={{ flex:1, padding:'8px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.35)', color:'#fff' }} />
          <button onClick={async()=>{
            try {
              const res = await fetch(`${apiBase}/api-tokens`, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ name: newTokenName || undefined }) });
              if (!res.ok) throw new Error('Token konnte nicht erstellt werden');
              const data = await res.json();
              setFreshToken(data.token);
              setNewTokenName('');
              const list = await fetch(`${apiBase}/api-tokens`, { credentials:'include' }).then(r=>r.json());
              setApiTokens(list);
            } catch (e:any) {
              alert(e.message || 'Fehler beim Erstellen');
            }
          }} style={{ padding:'8px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(16,185,129,0.2)', color:'#10b981' }}>Neuen Token erstellen</button>
        </div>
        {freshToken && (
          <div style={{ padding:10, borderRadius:8, border:'1px solid rgba(16,185,129,0.35)', background:'rgba(16,185,129,0.12)', color:'#d1fae5' }}>
            <div style={{ fontWeight:600, marginBottom:6 }}>Dein neuer Token (zeige ihn nur einmal an):</div>
            <code style={{ userSelect:'all' }}>{freshToken}</code>
          </div>
        )}
        <div style={{ fontWeight:600, marginTop: 4 }}>Deine Tokens</div>
        <div style={{ display:'grid', gap:6 }}>
          {(apiTokens||[]).map((t: any) => (
            <div key={t.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8, padding:'8px 10px' }}>
              <div>
                <div style={{ fontWeight:600 }}>{t.name || 'Token'}</div>
                <div style={{ fontSize:12, opacity:0.75 }}>Erstellt: {new Date(t.createdAt).toLocaleString()} {t.lastUsedAt ? `· Zuletzt genutzt: ${new Date(t.lastUsedAt).toLocaleString()}` : ''}</div>
              </div>
              <button onClick={async()=>{ try{ await fetch(`${apiBase}/api-tokens/${t.id}`, { method:'DELETE', credentials:'include' }); const list = await fetch(`${apiBase}/api-tokens`, { credentials:'include' }).then(r=>r.json()); setApiTokens(list); } catch(e:any){ alert(e.message||'Fehler beim Löschen'); } }} style={{ padding:'6px 8px', borderRadius:6, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(239,68,68,0.15)', color:'#fca5a5' }}>Löschen</button>
            </div>
          ))}
          {!apiTokens?.length && <div style={{ fontSize:13, opacity:0.7 }}>Noch keine Tokens erstellt.</div>}
        </div>
        <div style={{ fontWeight:600 }}>API-Dokumentation</div>
        <div>
          <div style={{ fontWeight:600, marginBottom:6 }}>Base URL</div>
          <code style={{ display:'block', padding:'8px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.35)' }}>{apiBase}</code>
        </div>
        <div>
          <div style={{ fontWeight:600, margin:'10px 0 6px' }}>Authentifizierung</div>
          <div style={{ fontSize:13, opacity:0.85 }}>Setze den HTTP Header Authorization: Bearer YOUR_TOKEN</div>
        </div>
        <div>
          <div style={{ fontWeight:600, margin:'10px 0 6px' }}>Steuer-Endpunkt</div>
          <code style={{ display:'block', padding:'8px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.35)' }}>POST /controls</code>
          <div style={{ fontSize:13, opacity:0.85, marginTop:6 }}>Body (JSON, mindestens ein Feld):</div>
          <code style={{ display:'block', padding:'8px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.35)' }}>{`{ "mic": true|false, "cam": true|false, "share": true|false, "dnd": true|false }`}</code>
          <div style={{ fontSize:13, opacity:0.85, marginTop:6 }}>Antwort: <code>{`{ "ok": true, "delivered": n }`}</code></div>
          <div style={{ fontSize:13, opacity:0.85, marginTop:6 }}>Hinweise: DND schaltet Mic/Kamera/Share automatisch aus. Steuerung funktioniert nur, wenn du online bist.</div>
        </div>
        <div>
          <div style={{ fontWeight:600, margin:'10px 0 6px' }}>Beispiel</div>
          <code style={{ display:'block', padding:'8px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.35)', whiteSpace:'pre-wrap' }}>{`curl -X POST "${apiBase}/controls" \n- H "Authorization: Bearer YOUR_TOKEN" \\\n- H "Content-Type: application/json" \\\n- d '{ "mic": false, "dnd": true }'`}</code>
        </div>
      </div>
    </Modal>
  );
}


