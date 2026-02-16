import React from 'react';
import { Modal } from '../system/Modal';
import { Input } from '../system/Input';
import { Button } from '../system/Button';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const [error, setError] = React.useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      fetch(`${apiBase}/api-tokens`, { credentials:'include' })
        .then(r => r.json())
        .then(list => setApiTokens(list));
    }
  }, [open, apiBase, setApiTokens]);

  return (
    <Modal open={open} onOpenChange={(o)=>{ if(!o) onClose(); }} title={t('admin.api.title')}>
      <div style={{ display:'grid', gap: 10 }}>
        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 16 }}>&#x2715;</button>
          </div>
        )}
        <div style={{ fontSize: 13, color: 'var(--fg-subtle)' }}>{t('admin.api.helper')}</div>
        <div style={{ display:'flex', gap: 12, alignItems:'center' }}>
          <Input value={newTokenName} onChange={e=>setNewTokenName(e.target.value)} placeholder={t('admin.api.newTokenPlaceholder')} style={{ flex:1, padding:'8px 10px' }} />
          <Button variant="brand" onClick={async()=>{
            try {
              const res = await fetch(`${apiBase}/api-tokens`, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ name: newTokenName || undefined }) });
              if (!res.ok) throw new Error('Token konnte nicht erstellt werden');
              const data = await res.json();
              setFreshToken(data.token);
              setNewTokenName('');
              const list = await fetch(`${apiBase}/api-tokens`, { credentials:'include' }).then(r=>r.json());
              setApiTokens(list);
            } catch (e:any) {
              setError(e.message || t('admin.api.createError'));
            }
          }}>{t('admin.api.createToken')}</Button>
        </div>
        {freshToken && (
          <div style={{ padding:10, borderRadius:8, border:'1px solid var(--border)', background:'var(--glass)', color:'var(--fg)' }}>
            <div style={{ fontWeight:600, marginBottom:6 }}>{t('admin.api.newTokenReveal')}</div>
            <code style={{ userSelect:'all' }}>{freshToken}</code>
          </div>
        )}
        <div style={{ fontWeight:600, marginTop: 4 }}>{t('admin.api.tokensHeader')}</div>
        <div style={{ display:'grid', gap:6 }}>
          {(apiTokens||[]).map((token: any) => (
            <div key={token.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', background:'var(--glass)' }}>
              <div>
                <div style={{ fontWeight:600 }}>{token.name || 'Token'}</div>
                <div style={{ fontSize:12, color:'var(--fg-subtle)' }}>{t('admin.api.createdAt')}: {new Date(token.createdAt).toLocaleString()} {token.lastUsedAt ? `· ${t('admin.api.lastUsed')}: ${new Date(token.lastUsedAt).toLocaleString()}` : ''}</div>
              </div>
              <Button variant="danger" onClick={async()=>{ try{ await fetch(`${apiBase}/api-tokens/${token.id}`, { method:'DELETE', credentials:'include' }); const list = await fetch(`${apiBase}/api-tokens`, { credentials:'include' }).then(r=>r.json()); setApiTokens(list); } catch(e:any){ setError(e.message || t('admin.api.deleteError')); } }} style={{ padding:'6px 8px' }}>{t('admin.api.delete')}</Button>
            </div>
          ))}
          {!apiTokens?.length && <div style={{ fontSize:13, color:'var(--fg-subtle)' }}>{t('admin.api.noneYet')}</div>}
        </div>
        <div style={{ fontWeight:600 }}>{t('admin.api.docs')}</div>
        <div>
          <div style={{ fontWeight:600, marginBottom:6 }}>{t('admin.api.baseUrl')}</div>
          <code style={{ display:'block', padding:'8px 10px', borderRadius:8, border:'1px solid var(--border)', background:'var(--glass)' }}>{apiBase}</code>
        </div>
        <div>
          <div style={{ fontWeight:600, margin:'10px 0 6px' }}>{t('admin.api.auth')}</div>
          <div style={{ fontSize:13, color:'var(--fg-subtle)' }}>{t('admin.api.authHint')}</div>
        </div>
        <div>
          <div style={{ fontWeight:600, margin:'10px 0 6px' }}>{t('admin.api.controlEndpoint')}</div>
          <code style={{ display:'block', padding:'8px 10px', borderRadius:8, border:'1px solid var(--border)', background:'var(--glass)' }}>POST /controls</code>
          <div style={{ fontSize:13, color:'var(--fg-subtle)', marginTop:6 }}>{t('admin.api.bodyHint')}</div>
          <code style={{ display:'block', padding:'8px 10px', borderRadius:8, border:'1px solid var(--border)', background:'var(--glass)' }}>{`{ "mic": true|false, "cam": true|false, "share": true|false, "dnd": true|false }`}</code>
          <div style={{ fontSize:13, color:'var(--fg-subtle)', marginTop:6 }}>{t('admin.api.responseHint')}: <code>{`{ "ok": true, "delivered": n }`}</code></div>
          <div style={{ fontSize:13, color:'var(--fg-subtle)', marginTop:6 }}>{t('admin.api.notes')}</div>
        </div>
        <div>
          <div style={{ fontWeight:600, margin:'10px 0 6px' }}>{t('admin.api.example')}</div>
          <code style={{ display:'block', padding:'8px 10px', borderRadius:8, border:'1px solid var(--border)', background:'var(--glass)', whiteSpace:'pre-wrap' }}>{`curl -X POST "${apiBase}/controls" \n- H "Authorization: Bearer YOUR_TOKEN" \\\n+ H "Content-Type: application/json" \\\n+ d '{ "mic": false, "dnd": true }'`}</code>
        </div>
      </div>
    </Modal>
  );
}


