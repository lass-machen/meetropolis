import {
  TableContainer,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
  Button,
  Input,
  Select,
} from '../system';
import type { TenantRow, AvailablePlan } from './TenantsAdmin';

const STATUS_OPTIONS = [
  { value: '', label: '— (kein Status)' },
  { value: 'active', label: 'active' },
  { value: 'suspended', label: 'suspended' },
  { value: 'trial', label: 'trial' },
];

interface TenantListTableProps {
  rows: TenantRow[];
  loading: boolean;
  plans: AvailablePlan[];
  deletingId: string | null;
  onArmDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<TenantRow>) => void;
  onSave: (row: TenantRow) => void;
  onOpenDetail: (row: TenantRow) => void;
  onCheckout: (priceId: string) => void;
  onPortal: () => void;
}

export function TenantListTable(props: TenantListTableProps) {
  const { rows, loading } = props;

  return (
    <TableContainer style={{ maxHeight: '60vh' }}>
      <Table>
        <THead>
          <Tr>
            <Th style={{ paddingLeft: 0 }}>Slug</Th>
            <Th>Name</Th>
            <Th>Online</Th>
            <Th>Limit</Th>
            <Th>Free-Limit</Th>
            <Th>Bypass</Th>
            <Th>Abo</Th>
            <Th>Status</Th>
            <Th>Default Map</Th>
            <Th style={{ paddingRight: 0 }}>{null}</Th>
          </Tr>
        </THead>
        {loading && <TenantLoadingBody />}
        {!loading && rows.length === 0 && <TenantEmptyBody />}
        {!loading && rows.length > 0 && <TenantBodyRows {...props} />}
      </Table>
    </TableContainer>
  );
}

function TenantLoadingBody() {
  return (
    <TBody>
      {[1, 2, 3].map((i) => (
        <Tr key={i}>
          <Td colSpan={10} style={{ paddingLeft: 0 }}>
            <div
              style={{
                height: 16,
                borderRadius: 4,
                background: 'var(--glass-hover)',
                animation: 'pulse 1.5s ease-in-out infinite',
                width: `${60 + i * 10}%`,
              }}
            />
          </Td>
        </Tr>
      ))}
    </TBody>
  );
}

function TenantEmptyBody() {
  return (
    <TBody>
      <Tr>
        <Td
          colSpan={10}
          style={{
            paddingLeft: 0,
            textAlign: 'center',
            color: 'var(--fg-subtle)',
            padding: '32px 0',
          }}
        >
          Keine Einträge vorhanden
        </Td>
      </Tr>
    </TBody>
  );
}

function TenantBodyRows({
  rows,
  plans,
  deletingId,
  onArmDelete,
  onConfirmDelete,
  onUpdate,
  onSave,
  onOpenDetail,
  onCheckout,
  onPortal,
}: TenantListTableProps) {
  return (
    <TBody>
      {rows.map((r) => (
        <TenantRowView
          key={r.id}
          row={r}
          plans={plans}
          deletingId={deletingId}
          onUpdate={onUpdate}
          onSave={onSave}
          onConfirmDelete={onConfirmDelete}
          onArmDelete={onArmDelete}
          onOpenDetail={onOpenDetail}
          onCheckout={onCheckout}
          onPortal={onPortal}
        />
      ))}
    </TBody>
  );
}

interface TenantRowViewProps {
  row: TenantRow;
  plans: AvailablePlan[];
  deletingId: string | null;
  onUpdate: (id: string, patch: Partial<TenantRow>) => void;
  onSave: (row: TenantRow) => void;
  onConfirmDelete: (id: string) => void;
  onArmDelete: (id: string) => void;
  onOpenDetail: (row: TenantRow) => void;
  onCheckout: (priceId: string) => void;
  onPortal: () => void;
}

function TenantRowView({
  row,
  plans,
  deletingId,
  onUpdate,
  onSave,
  onConfirmDelete,
  onArmDelete,
  onOpenDetail,
  onCheckout,
  onPortal,
}: TenantRowViewProps) {
  return (
    <Tr>
      <Td style={{ paddingLeft: 0 }}>{row.slug}</Td>
      <Td>
        <Input value={row.name} onChange={(e) => onUpdate(row.id, { name: e.target.value })} />
      </Td>
      <Td>{row.online}</Td>
      <Td>
        <Input
          type="number"
          value={row.concurrentLimit}
          onChange={(e) => onUpdate(row.id, { concurrentLimit: Number(e.target.value) || 0 })}
          style={{ width: 100 }}
        />
      </Td>
      <Td>
        <Input
          type="number"
          value={row.freeSeats ?? 0}
          onChange={(e) => onUpdate(row.id, { freeSeats: Number(e.target.value) || 0 })}
          style={{ width: 100 }}
        />
      </Td>
      <Td>
        <input
          type="checkbox"
          checked={row.bypassLimits}
          onChange={(e) => onUpdate(row.id, { bypassLimits: e.target.checked })}
        />
      </Td>
      <Td>
        <TenantPlanCell row={row} plans={plans} onCheckout={onCheckout} onPortal={onPortal} />
      </Td>
      <Td>
        <Select
          value={row.status ?? ''}
          onChange={(val) => onUpdate(row.id, { status: val ? val : null })}
          options={STATUS_OPTIONS}
          placeholder="—"
          style={{ width: 140 }}
        />
      </Td>
      <Td>
        <Input
          value={row.defaultMapName ?? ''}
          placeholder="—"
          onChange={(e) => onUpdate(row.id, { defaultMapName: e.target.value || null })}
          style={{ width: 140 }}
        />
      </Td>
      <Td style={{ paddingRight: 0, textAlign: 'right' }}>
        <TenantRowActions
          row={row}
          deletingId={deletingId}
          onSave={onSave}
          onArmDelete={onArmDelete}
          onConfirmDelete={onConfirmDelete}
          onOpenDetail={onOpenDetail}
        />
      </Td>
    </Tr>
  );
}

function TenantPlanCell({
  row,
  plans,
  onCheckout,
  onPortal,
}: {
  row: TenantRow;
  plans: AvailablePlan[];
  onCheckout: (priceId: string) => void;
  onPortal: () => void;
}) {
  return (
    <>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {plans.length > 0 ? (
          <Select
            value=""
            onChange={(val) => onCheckout(val)}
            placeholder="Plan…"
            style={{ width: 'auto' }}
            options={plans.map((p) => ({
              value: p.priceId,
              label: `${p.name} (${p.amount} ${p.currency}/${p.interval})`,
            }))}
          />
        ) : (
          <span style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Keine Pläne</span>
        )}
        <Button size="sm" onClick={() => onPortal()}>
          Portal
        </Button>
      </div>
      {row.stripeCustomerId ? (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--fg-subtle)' }}>
          Cust: <code>{(row.stripeCustomerId || '').slice(0, 10)}…</code>{' '}
          {row.stripeSubscriptionId ? (
            <>
              Sub: <code>{(row.stripeSubscriptionId || '').slice(0, 10)}…</code>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function TenantRowActions({
  row,
  deletingId,
  onSave,
  onArmDelete,
  onConfirmDelete,
  onOpenDetail,
}: {
  row: TenantRow;
  deletingId: string | null;
  onSave: (row: TenantRow) => void;
  onArmDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onOpenDetail: (row: TenantRow) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
      <Button size="sm" variant="secondary" onClick={() => onOpenDetail(row)}>
        Details
      </Button>
      <Button size="sm" variant="primary" onClick={() => onSave(row)}>
        Speichern
      </Button>
      {!row.isInternal && (
        <Button
          size="sm"
          variant="danger"
          onClick={() => (deletingId === row.id ? onConfirmDelete(row.id) : onArmDelete(row.id))}
        >
          {deletingId === row.id ? 'Wirklich löschen?' : 'Löschen'}
        </Button>
      )}
    </div>
  );
}
