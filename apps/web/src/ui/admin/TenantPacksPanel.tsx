import React from 'react';
import {
  Section,
  Button,
  Alert,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
  TableContainer,
  Badge,
} from '../system';
import { logger } from '../../lib/logger';

interface TenantPacksPanelProps {
  apiBase: string;
  tenantId: string;
}

type PackEntry = {
  uuid?: string | null;
  packUuid?: string | null;
  name?: string | null;
  grantSource?: string | null;
  source?: string | null;
};

type PacksResponse = {
  assetPacks?: PackEntry[] | null;
  avatarPacks?: PackEntry[] | null;
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: PacksResponse };

export function TenantPacksPanel({ apiBase, tenantId }: TenantPacksPanelProps) {
  const [state, setState] = React.useState<LoadState>({ kind: 'loading' });

  const load = React.useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch(`${apiBase}/admin/tenants/${tenantId}/packs`, {
        credentials: 'include',
      });
      if (res.status === 404) {
        setState({ kind: 'unavailable' });
        return;
      }
      if (!res.ok) {
        setState({ kind: 'error', message: `HTTP ${res.status}` });
        return;
      }
      const data: PacksResponse = await res.json();
      setState({ kind: 'ready', data });
    } catch (err) {
      logger.warn('[TenantPacksPanel] Failed to load packs', err);
      setState({ kind: 'error', message: 'Verbindung fehlgeschlagen' });
    }
  }, [apiBase, tenantId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <Section
      title="Packs"
      description="Asset- und Avatar-Packs, die diesem Tenant zugeordnet sind."
      actions={
        <Button size="sm" onClick={() => void load()}>
          Neu laden
        </Button>
      }
    >
      <PacksContent state={state} />
    </Section>
  );
}

function PacksContent({ state }: { state: LoadState }) {
  if (state.kind === 'loading') {
    return (
      <div style={{ color: 'var(--fg-subtle)', padding: '24px 0', textAlign: 'center' }}>
        Lade Packs…
      </div>
    );
  }

  if (state.kind === 'unavailable') {
    return (
      <Alert intent="info">
        Pack-Verwaltung nicht verfügbar — dieser Bereich erfordert das @meetropolis/billing
        Submodule.
      </Alert>
    );
  }

  if (state.kind === 'error') {
    return <Alert intent="error">Fehler beim Laden: {state.message}</Alert>;
  }

  const assetPacks = state.data.assetPacks ?? [];
  const avatarPacks = state.data.avatarPacks ?? [];

  if (assetPacks.length === 0 && avatarPacks.length === 0) {
    return (
      <div style={{ color: 'var(--fg-subtle)', padding: '24px 0', textAlign: 'center' }}>
        Keine Packs zugeordnet
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {assetPacks.length > 0 && (
        <PackTable title="Asset Packs" packs={assetPacks} typeLabel="Asset" />
      )}
      {avatarPacks.length > 0 && (
        <PackTable title="Avatar Packs" packs={avatarPacks} typeLabel="Avatar" />
      )}
    </div>
  );
}

function PackTable({
  title,
  packs,
  typeLabel,
}: {
  title: string;
  packs: PackEntry[];
  typeLabel: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--fg)' }}>
        {title}
      </div>
      <TableContainer>
        <Table>
          <THead>
            <Tr>
              <Th style={{ paddingLeft: 0 }}>Name</Th>
              <Th>Typ</Th>
              <Th>Source</Th>
              <Th style={{ paddingRight: 0 }}>UUID</Th>
            </Tr>
          </THead>
          <TBody>
            {packs.map((pack, idx) => (
              <Tr key={pack.uuid || pack.packUuid || idx}>
                <Td style={{ paddingLeft: 0 }}>
                  <strong>{pack.name || '—'}</strong>
                </Td>
                <Td>
                  <Badge intent="default">{typeLabel}</Badge>
                </Td>
                <Td>{pack.grantSource || pack.source || '—'}</Td>
                <Td style={{ paddingRight: 0 }}>
                  <code style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>
                    {pack.uuid || pack.packUuid || '—'}
                  </code>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableContainer>
    </div>
  );
}
