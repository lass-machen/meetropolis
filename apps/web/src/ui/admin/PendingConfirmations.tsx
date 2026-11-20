import React from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, TableContainer, Table, THead, TBody, Tr, Th, Td } from '../system';
import { logger } from '../../lib/logger';

type PendingConfirmation = {
  userId: string;
  email: string;
  name: string | null;
  tenantId: string;
  tenantName: string | null;
  role: string;
  requestedAt: string;
  expiresAt: string;
};

type PendingResponse = { pending: PendingConfirmation[] };

type FetchError = Error & { code?: string };

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { credentials: 'include', ...init });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    const failure = new Error(err.error || `HTTP ${res.status}`) as FetchError;
    if (err.code) failure.code = err.code;
    throw failure;
  }
  return (await res.json()) as T;
}

function errorCode(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const code = (err as FetchError).code;
  return typeof code === 'string' ? code : null;
}

export function PendingConfirmations(props: { apiBase: string }) {
  const { apiBase } = props;
  const { t } = useTranslation();
  const [rows, setRows] = React.useState<PendingConfirmation[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [unavailable, setUnavailable] = React.useState(false);
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await jsonFetch<PendingResponse>(`${apiBase}/admin/pending-confirmations`);
      setRows(data.pending);
      setUnavailable(false);
    } catch (err) {
      if (errorCode(err) === 'MANUAL_CONFIRMATION_UNAVAILABLE') {
        setRows([]);
        setUnavailable(true);
      } else {
        logger.warn('[PendingConfirmations] Failed to load pending confirmations', err);
        setError(t('admin.pendingConfirmations.loadFailed'));
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, t]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  async function confirm(userId: string) {
    setConfirmingId(userId);
    setError(null);
    try {
      await jsonFetch(`${apiBase}/admin/users/${userId}/confirm-email`, { method: 'POST' });
      await reload();
    } catch (err) {
      if (errorCode(err) === 'MANUAL_CONFIRMATION_UNAVAILABLE') {
        setUnavailable(true);
      } else {
        logger.warn('[PendingConfirmations] Failed to confirm account', err);
        setError(t('admin.pendingConfirmations.confirmFailed'));
      }
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1 }} />
        <Button onClick={() => void reload()}>
          {loading ? t('admin.pendingConfirmations.loading') : t('admin.pendingConfirmations.reload')}
        </Button>
      </div>
      {error && <Alert intent="error">{error}</Alert>}
      {unavailable && <Alert intent="info">{t('admin.pendingConfirmations.unavailable')}</Alert>}
      {!unavailable && (
        <TableContainer style={{ maxHeight: '55vh' }}>
          <Table>
            <THead sticky>
              <Tr>
                <Th>{t('admin.pendingConfirmations.colEmail')}</Th>
                <Th>{t('admin.pendingConfirmations.colName')}</Th>
                <Th>{t('admin.pendingConfirmations.colTenant')}</Th>
                <Th>{t('admin.pendingConfirmations.colRole')}</Th>
                <Th>{t('admin.pendingConfirmations.colRequestedAt')}</Th>
                <Th>{t('admin.pendingConfirmations.colExpiresAt')}</Th>
                <Th>{t('admin.pendingConfirmations.colActions')}</Th>
              </Tr>
            </THead>
            <TBody>
              {!loading && rows.length === 0 && (
                <Tr>
                  <Td colSpan={7} style={{ textAlign: 'center', color: 'var(--fg-subtle)', padding: '32px 0' }}>
                    {t('admin.pendingConfirmations.empty')}
                  </Td>
                </Tr>
              )}
              {rows.map((row) => (
                <Tr key={row.userId}>
                  <Td>{row.email}</Td>
                  <Td>{row.name ?? '—'}</Td>
                  <Td>{row.tenantName ?? '—'}</Td>
                  <Td>{row.role}</Td>
                  <Td style={{ fontSize: 12 }}>{new Date(row.requestedAt).toLocaleString()}</Td>
                  <Td style={{ fontSize: 12 }}>{new Date(row.expiresAt).toLocaleString()}</Td>
                  <Td>
                    <Button
                      size="xs"
                      variant="primary"
                      disabled={confirmingId === row.userId}
                      onClick={() => void confirm(row.userId)}
                    >
                      {confirmingId === row.userId
                        ? t('admin.pendingConfirmations.confirming')
                        : t('admin.pendingConfirmations.confirm')}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
}

export default PendingConfirmations;
