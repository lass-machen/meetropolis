import React from 'react';
import { Modal } from '../system/Modal';
import { Input } from '../system/Input';
import { Button } from '../system/Button';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

type ApiToken = { id: string; name?: string | null; createdAt: string; lastUsedAt?: string | null };

interface CreateTokenResponse {
  token: string;
}

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
  onDelete,
}: {
  token: ApiToken;
  t: (k: string) => string;
  onDelete: () => Promise<void>;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
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
      </div>
      <Button
        variant="danger"
        onClick={() => {
          void onDelete();
        }}
        style={{ padding: '6px 8px' }}
      >
        {t('admin.api.delete')}
      </Button>
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
        >{`{ "mic": true|false, "cam": true|false, "share": true|false, "dnd": true|false }`}</code>
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
        >{`curl -X POST "${apiBase}/controls" \n- H "Authorization: Bearer YOUR_TOKEN" \\\n+ H "Content-Type: application/json" \\\n+ d '{ "mic": false, "dnd": true }'`}</code>
      </div>
    </>
  );
}

export function ApiTokensOverlay(props: ApiTokensOverlayProps) {
  const { open, onClose, apiBase, apiTokens, setApiTokens, newTokenName, setNewTokenName, freshToken, setFreshToken } =
    props;
  const { t } = useTranslation();
  const [error, setError] = React.useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      void fetch(`${apiBase}/api-tokens`, { credentials: 'include' })
        .then((r) => r.json() as Promise<ApiToken[]>)
        .then((list) => setApiTokens(list));
    }
  }, [open, apiBase, setApiTokens]);

  const createToken = async () => {
    try {
      const res = await fetch(`${apiBase}/api-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newTokenName || undefined }),
      });
      if (!res.ok) throw new Error('Token could not be created');
      const data = (await res.json()) as CreateTokenResponse;
      setFreshToken(data.token);
      setNewTokenName('');
      const list = (await fetch(`${apiBase}/api-tokens`, { credentials: 'include' }).then((r) =>
        r.json(),
      )) as ApiToken[];
      setApiTokens(list);
    } catch (e: unknown) {
      // TODO i18n: surface validation messages via translation keys
      setError((e instanceof Error ? e.message : null) || t('admin.api.createError'));
    }
  };

  const deleteToken = async (id: string) => {
    try {
      await fetch(`${apiBase}/api-tokens/${id}`, { method: 'DELETE', credentials: 'include' });
      const list = (await fetch(`${apiBase}/api-tokens`, { credentials: 'include' }).then((r) =>
        r.json(),
      )) as ApiToken[];
      setApiTokens(list);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) || t('admin.api.deleteError'));
    }
  };

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
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Input
            value={newTokenName}
            onChange={(e) => setNewTokenName(e.target.value)}
            placeholder={t('admin.api.newTokenPlaceholder')}
            style={{ flex: 1, padding: '8px 10px' }}
          />
          <Button
            variant="brand"
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
            <TokenRow key={token.id} token={token} t={t} onDelete={() => deleteToken(token.id)} />
          ))}
          {!apiTokens?.length && (
            <div style={{ fontSize: 13, color: 'var(--fg-subtle)' }}>{t('admin.api.noneYet')}</div>
          )}
        </div>
        <ApiDocs apiBase={apiBase} t={t} />
      </div>
    </Modal>
  );
}
