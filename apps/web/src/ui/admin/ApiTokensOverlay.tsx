import { Modal } from '../system/Modal';
import { Input } from '../system/Input';
import { Button } from '../system/Button';
import { useTranslation } from 'react-i18next';
import { useApiTokenActions } from '../../features/admin/useApiTokenActions';

type ApiToken = { id: string; name?: string | null; createdAt: string; lastUsedAt?: string | null };

type ApiTokensOverlayProps = {
  open: boolean;
  onClose: () => void;
  apiBase: string;
  apiTokens: ApiToken[];
  setApiTokens: (v: ApiToken[]) => void;
  newTokenName: string;
  setNewTokenName: (v: string) => void;
  freshToken: string | null;
  setFreshToken: (v: string | null) => void;
};

function ErrorBanner({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        background: 'rgba(239,68,68,0.1)',
        border: '1px solid rgba(239,68,68,0.3)',
        color: '#fca5a5',
        fontSize: 13,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <span>{error}</span>
      <button
        onClick={onDismiss}
        style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 16 }}
      >
        &#x2715;
      </button>
    </div>
  );
}

function TokenRow({
  token,
  t,
  confirming,
  disabled,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  token: ApiToken;
  t: (k: string) => string;
  /** True while this row waits for the second click that really deletes. */
  confirming: boolean;
  disabled: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '8px 10px',
        background: 'var(--glass)',
      }}
    >
      <div>
        <div style={{ fontWeight: 600 }}>{token.name || 'Token'}</div>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
          {t('admin.api.createdAt')}: {new Date(token.createdAt).toLocaleString()}{' '}
          {token.lastUsedAt ? `· ${t('admin.api.lastUsed')}: ${new Date(token.lastUsedAt).toLocaleString()}` : ''}
        </div>
        {confirming && <div style={{ fontSize: 12, marginTop: 4 }}>{t('admin.api.confirmDeleteHint')}</div>}
      </div>
      {confirming ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Button variant="danger" onClick={onConfirmDelete} disabled={disabled} style={{ padding: '6px 8px' }}>
            {t('admin.api.confirmDelete')}
          </Button>
          <Button onClick={onCancelDelete} disabled={disabled} style={{ padding: '6px 8px' }}>
            {t('admin.api.cancel')}
          </Button>
        </div>
      ) : (
        <Button variant="danger" onClick={onAskDelete} disabled={disabled} style={{ padding: '6px 8px' }}>
          {t('admin.api.delete')}
        </Button>
      )}
    </div>
  );
}

function ApiDocs({ apiBase, t }: { apiBase: string; t: (k: string) => string }) {
  return (
    <>
      <div style={{ fontWeight: 600 }}>{t('admin.api.docs')}</div>
      <div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('admin.api.baseUrl')}</div>
        <code
          style={{
            display: 'block',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--glass)',
          }}
        >
          {apiBase}
        </code>
      </div>
      <div>
        <div style={{ fontWeight: 600, margin: '10px 0 6px' }}>{t('admin.api.auth')}</div>
        <div style={{ fontSize: 13, color: 'var(--fg-subtle)' }}>{t('admin.api.authHint')}</div>
      </div>
      <div>
        <div style={{ fontWeight: 600, margin: '10px 0 6px' }}>{t('admin.api.controlEndpoint')}</div>
        <code
          style={{
            display: 'block',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--glass)',
          }}
        >
          POST /controls
        </code>
        <div style={{ fontSize: 13, color: 'var(--fg-subtle)', marginTop: 6 }}>{t('admin.api.bodyHint')}</div>
        <code
          style={{
            display: 'block',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--glass)',
          }}
        >{`{ "mic": false, "cam": false, "share": false }`}</code>
        <div style={{ fontSize: 13, color: 'var(--fg-subtle)', marginTop: 6 }}>
          {t('admin.api.responseHint')}: <code>{`{ "ok": true, "delivered": n }`}</code>
        </div>
        <div style={{ fontSize: 13, color: 'var(--fg-subtle)', marginTop: 6 }}>{t('admin.api.notes')}</div>
      </div>
      <div>
        <div style={{ fontWeight: 600, margin: '10px 0 6px' }}>{t('admin.api.example')}</div>
        <code
          style={{
            display: 'block',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--glass)',
            whiteSpace: 'pre-wrap',
          }}
        >{`curl -X POST "${apiBase}/controls" \\\n  -H "Authorization: Bearer YOUR_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "mic": false }'`}</code>
      </div>
    </>
  );
}

export function ApiTokensOverlay(props: ApiTokensOverlayProps) {
  const { open, onClose, apiBase, apiTokens, setApiTokens, newTokenName, setNewTokenName, freshToken, setFreshToken } =
    props;
  const { t } = useTranslation();
  const { error, setError, listState, busy, pendingDeleteId, setPendingDeleteId, createToken, deleteToken } =
    useApiTokenActions({ open, apiBase, newTokenName, setApiTokens, setNewTokenName, setFreshToken });

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('admin.api.title')}
    >
      <div style={{ display: 'grid', gap: 10 }}>
        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
        <div style={{ fontSize: 13, color: 'var(--fg-subtle)' }}>{t('admin.api.helper')}</div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{t('admin.api.securityHint')}</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Input
            value={newTokenName}
            onChange={(e) => setNewTokenName(e.target.value)}
            placeholder={t('admin.api.newTokenPlaceholder')}
            style={{ flex: 1, padding: '8px 10px' }}
          />
          <Button
            variant="brand"
            disabled={busy}
            onClick={() => {
              void createToken();
            }}
          >
            {t('admin.api.createToken')}
          </Button>
        </div>
        {freshToken && (
          <div
            style={{
              padding: 10,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--glass)',
              color: 'var(--fg)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('admin.api.newTokenReveal')}</div>
            <code style={{ userSelect: 'all' }}>{freshToken}</code>
          </div>
        )}
        <div style={{ fontWeight: 600, marginTop: 4 }}>{t('admin.api.tokensHeader')}</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {(apiTokens || []).map((token) => (
            <TokenRow
              key={token.id}
              token={token}
              t={t}
              confirming={pendingDeleteId === token.id}
              disabled={busy}
              onAskDelete={() => setPendingDeleteId(token.id)}
              onCancelDelete={() => setPendingDeleteId(null)}
              onConfirmDelete={() => {
                void deleteToken(token.id);
              }}
            />
          ))}
          {listState === 'loaded' && !apiTokens?.length && (
            <div style={{ fontSize: 13, color: 'var(--fg-subtle)' }}>{t('admin.api.noneYet')}</div>
          )}
        </div>
        <ApiDocs apiBase={apiBase} t={t} />
      </div>
    </Modal>
  );
}
