import React from 'react';
import { TableContainer, Table, THead, TBody, Tr, Th, Td, Button, Select, Input } from '../system';
import type { PackWithCatalog, PricingModel, CatalogData } from '../packstore/packStoreTypes';

interface PackCatalogTableProps {
  apiBase: string;
  packType: 'asset' | 'avatar';
  packs: PackWithCatalog[];
  onReload: () => void;
  onGrant: (packUuid: string) => void;
}

const DEFAULT_CATALOG: CatalogData = {
  pricingModel: 'free',
  published: false,
  featured: false,
  stripeProductId: null,
  stripePriceId: null,
  priceAmountCents: 0,
  priceCurrency: 'EUR',
  priceInterval: null,
  previewImageUrl: null,
  tags: [],
};

function useEditState(_packs: PackWithCatalog[]) {
  const [edits, setEdits] = React.useState<Record<string, Partial<CatalogData>>>({});

  const getField = <K extends keyof CatalogData>(uuid: string, field: K, catalog: CatalogData | null): CatalogData[K] => {
    const e = edits[uuid];
    if (e && field in e) return e[field] as CatalogData[K];
    return (catalog ?? DEFAULT_CATALOG)[field];
  };

  const setField = <K extends keyof CatalogData>(uuid: string, field: K, value: CatalogData[K]) => {
    setEdits(prev => ({ ...prev, [uuid]: { ...prev[uuid], [field]: value } }));
  };

  const clearEdit = (uuid: string) => {
    setEdits(prev => { const next = { ...prev }; delete next[uuid]; return next; });
  };

  const hasEdits = (uuid: string) => !!edits[uuid];

  return { getField, setField, clearEdit, hasEdits };
}

export function PackCatalogTable({ apiBase, packType, packs, onReload, onGrant }: PackCatalogTableProps) {
  const { getField, setField, clearEdit, hasEdits } = useEditState(packs);
  const [saving, setSaving] = React.useState<string | null>(null);

  const handleSave = async (pack: PackWithCatalog) => {
    setSaving(pack.uuid);
    try {
      const res = await fetch(`${apiBase}/admin/pack-catalog/${packType}-packs/${pack.uuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          pricingModel: getField(pack.uuid, 'pricingModel', pack.catalog),
          published: getField(pack.uuid, 'published', pack.catalog),
          featured: getField(pack.uuid, 'featured', pack.catalog),
          stripeProductId: getField(pack.uuid, 'stripeProductId', pack.catalog),
          stripePriceId: getField(pack.uuid, 'stripePriceId', pack.catalog),
          priceAmountCents: getField(pack.uuid, 'priceAmountCents', pack.catalog),
          priceCurrency: getField(pack.uuid, 'priceCurrency', pack.catalog),
          priceInterval: getField(pack.uuid, 'priceInterval', pack.catalog),
        }),
      });
      if (res.ok) {
        clearEdit(pack.uuid);
        onReload();
      }
    } catch { /* handled by UI */ }
    setSaving(null);
  };

  const handleRevoke = async (packUuid: string, tenantId: string) => {
    try {
      const res = await fetch(`${apiBase}/admin/pack-catalog/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tenantId, packType, packUuid }),
      });
      if (res.ok) onReload();
    } catch { /* handled by UI */ }
  };

  return (
    <TableContainer style={{ maxHeight: '55vh' }}>
      <Table>
        <THead sticky style={{ background: 'transparent' }}>
          <Tr>
            <Th style={{ paddingLeft: 0 }}>Name</Th>
            <Th>Author</Th>
            <Th>Version</Th>
            <Th>Pricing</Th>
            <Th style={{ width: 60 }}>Published</Th>
            <Th style={{ width: 60 }}>Featured</Th>
            <Th>Price (Cents)</Th>
            <Th style={{ paddingRight: 0 }}>{null}</Th>
          </Tr>
        </THead>
        <TBody>
          {packs.map(p => (
            <PackRow
              key={p.uuid}
              pack={p}
              getField={getField}
              setField={setField}
              hasEdits={hasEdits(p.uuid)}
              saving={saving === p.uuid}
              onSave={() => handleSave(p)}
              onGrant={() => onGrant(p.uuid)}
              onRevoke={(tenantId) => handleRevoke(p.uuid, tenantId)}
            />
          ))}
        </TBody>
      </Table>
    </TableContainer>
  );
}

interface PackRowProps {
  pack: PackWithCatalog;
  getField: <K extends keyof CatalogData>(uuid: string, field: K, catalog: CatalogData | null) => CatalogData[K];
  setField: <K extends keyof CatalogData>(uuid: string, field: K, value: CatalogData[K]) => void;
  hasEdits: boolean;
  saving: boolean;
  onSave: () => void;
  onGrant: () => void;
  onRevoke: (tenantId: string) => void;
}

function PackRow({ pack, getField, setField, hasEdits, saving, onSave, onGrant }: PackRowProps) {
  const { uuid, catalog } = pack;

  return (
    <Tr>
      <Td style={{ paddingLeft: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{pack.name}</div>
        <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{pack.uuid.slice(0, 8)}...</div>
      </Td>
      <Td>{pack.author}</Td>
      <Td><code>{pack.version}</code></Td>
      <Td>
        <Select
          value={getField(uuid, 'pricingModel', catalog)}
          onChange={(val) => setField(uuid, 'pricingModel', val as PricingModel)}
          style={{ width: 130 }}
          options={[
            { value: 'free', label: 'Free' },
            { value: 'one_time', label: 'One-time' },
            { value: 'subscription', label: 'Subscription' },
          ]}
        />
      </Td>
      <Td>
        <input
          type="checkbox"
          checked={getField(uuid, 'published', catalog)}
          onChange={e => setField(uuid, 'published', e.target.checked)}
        />
      </Td>
      <Td>
        <input
          type="checkbox"
          checked={getField(uuid, 'featured', catalog)}
          onChange={e => setField(uuid, 'featured', e.target.checked)}
        />
      </Td>
      <Td>
        <Input
          type="number"
          value={getField(uuid, 'priceAmountCents', catalog)}
          onChange={e => setField(uuid, 'priceAmountCents', Number(e.target.value) || 0)}
          style={{ width: 100, padding: '6px 8px', fontSize: 12 }}
        />
      </Td>
      <Td style={{ paddingRight: 0, textAlign: 'right' }}>
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          <Button size="sm" onClick={onSave} disabled={!hasEdits || saving} variant={hasEdits ? 'primary' : 'secondary'}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button size="sm" onClick={onGrant} variant="secondary">Grant</Button>
        </div>
      </Td>
    </Tr>
  );
}
