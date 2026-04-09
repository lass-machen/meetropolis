import React from 'react';
import {
  Button,
  Select,
  Alert,
  Badge,
  TableContainer,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
} from '../system';
import { logger } from '../../lib/logger';

type TenantOption = {
  id: string;
  slug: string;
  name: string;
};

type AuditLogEntry = {
  id?: string;
  tenantId?: string | null;
  eventType?: string;
  event?: string;
  source?: string | null;
  createdAt?: string;
  timestamp?: string;
  metadata?: Record<string, unknown> | null;
  data?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null;
};

type AuditLogResponse = {
  logs?: AuditLogEntry[];
  total?: number;
};

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';

const ALL_TENANTS = '__all__';
const ALL_EVENTS = '__all__';

const EVENT_TYPE_OPTIONS = [
  { value: ALL_EVENTS, label: '— Alle Events —' },
  { value: 'subscription_created', label: 'subscription_created' },
  { value: 'subscription_updated', label: 'subscription_updated' },
  { value: 'subscription_deleted', label: 'subscription_deleted' },
  { value: 'payment_succeeded', label: 'payment_succeeded' },
  { value: 'payment_failed', label: 'payment_failed' },
  { value: 'invoice_created', label: 'invoice_created' },
  { value: 'trial_started', label: 'trial_started' },
  { value: 'trial_ended', label: 'trial_ended' },
  { value: 'dunning_started', label: 'dunning_started' },
  { value: 'dunning_escalated', label: 'dunning_escalated' },
  { value: 'tenant_suspended', label: 'tenant_suspended' },
  { value: 'tenant_paused', label: 'tenant_paused' },
];

const PAGE_SIZE = 50;

function useAuditState() {
  const [logs, setLogs] = React.useState<AuditLogEntry[]>([]);
  const [tenants, setTenants] = React.useState<TenantOption[]>([]);
  const [total, setTotal] = React.useState(0);
  const [offset, setOffset] = React.useState(0);
  const [tenantFilter, setTenantFilter] = React.useState(ALL_TENANTS);
  const [eventFilter, setEventFilter] = React.useState(ALL_EVENTS);
  const [status, setStatus] = React.useState<LoadStatus>('idle');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  return {
    logs, tenants, total, offset, tenantFilter, eventFilter, status, errorMessage, expanded,
    setLogs, setTenants, setTotal, setOffset, setTenantFilter, setEventFilter,
    setStatus, setErrorMessage, setExpanded,
  };
}
type State = ReturnType<typeof useAuditState>;

async function loadAuditTenants(apiBase: string, s: State): Promise<void> {
  try {
    const res = await fetch(`${apiBase}/admin/tenants`, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    s.setTenants(await res.json());
  } catch (err) {
    logger.warn('[AuditLogAdmin] Failed to load tenants', err);
  }
}

async function loadAuditLogs(apiBase: string, s: State): Promise<void> {
  s.setStatus('loading');
  s.setErrorMessage(null);
  try {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(s.offset));
    if (s.tenantFilter && s.tenantFilter !== ALL_TENANTS) params.set('tenantId', s.tenantFilter);
    if (s.eventFilter && s.eventFilter !== ALL_EVENTS) params.set('eventType', s.eventFilter);
    const res = await fetch(`${apiBase}/admin/billing/audit-log?${params.toString()}`, {
      credentials: 'include',
    });
    if (res.status === 404 || res.status === 501) {
      s.setStatus('unavailable');
      s.setLogs([]);
      s.setTotal(0);
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err?.error === 'not_found') {
        s.setStatus('unavailable');
        s.setLogs([]);
        s.setTotal(0);
        return;
      }
      throw new Error(err?.error || `HTTP ${res.status}`);
    }
    const data: AuditLogResponse = await res.json();
    s.setLogs(data.logs || []);
    s.setTotal(data.total || 0);
    s.setStatus('ready');
  } catch (err) {
    logger.warn('[AuditLogAdmin] Failed to load audit log', err);
    s.setErrorMessage(err instanceof Error ? err.message : String(err));
    s.setStatus('error');
  }
}

export function AuditLogAdmin(props: { apiBase: string }) {
  const { apiBase } = props;
  const state = useAuditState();
  const { logs, tenants, total, offset, status, errorMessage, expanded } = state;

  const reload = React.useCallback(() => {
    void loadAuditLogs(apiBase, state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, offset, state.tenantFilter, state.eventFilter]);

  React.useEffect(() => {
    void loadAuditTenants(apiBase, state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  const tenantOptions = React.useMemo(
    () => [
      { value: ALL_TENANTS, label: '— Alle Tenants —' },
      ...tenants.map((t) => ({ value: t.id, label: `${t.slug} — ${t.name}` })),
    ],
    [tenants],
  );

  const tenantBySlug = React.useMemo(() => {
    const map = new Map<string, string>();
    tenants.forEach((t) => map.set(t.id, t.slug));
    return map;
  }, [tenants]);

  const toggleRow = (rowKey: string) => {
    state.setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  return (
    <AuditLogView
      state={state}
      logs={logs}
      total={total}
      offset={offset}
      status={status}
      errorMessage={errorMessage}
      expanded={expanded}
      tenantOptions={tenantOptions}
      tenantBySlug={tenantBySlug}
      onApplyFilters={() => {
        state.setOffset(0);
        reload();
      }}
      onPrev={() => state.setOffset(Math.max(0, offset - PAGE_SIZE))}
      onNext={() => state.setOffset(offset + PAGE_SIZE)}
      onToggleRow={toggleRow}
    />
  );
}

type ViewProps = {
  state: State;
  logs: AuditLogEntry[];
  total: number;
  offset: number;
  status: LoadStatus;
  errorMessage: string | null;
  expanded: Set<string>;
  tenantOptions: { value: string; label: string }[];
  tenantBySlug: Map<string, string>;
  onApplyFilters: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleRow: (rowKey: string) => void;
};

function AuditLogView(props: ViewProps) {
  const {
    state, logs, total, offset, status, errorMessage, expanded,
    tenantOptions, tenantBySlug, onApplyFilters, onPrev, onNext, onToggleRow,
  } = props;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <FilterBar
        tenantFilter={state.tenantFilter}
        eventFilter={state.eventFilter}
        tenantOptions={tenantOptions}
        loading={status === 'loading'}
        onTenantChange={(v) => {
          state.setTenantFilter(v);
          state.setOffset(0);
        }}
        onEventChange={(v) => {
          state.setEventFilter(v);
          state.setOffset(0);
        }}
        onApply={onApplyFilters}
      />
      {status === 'unavailable' && (
        <Alert intent="info">
          Enterprise Billing nicht verfügbar — Audit Log erfordert das @meetropolis/billing Submodule.
        </Alert>
      )}
      {status === 'error' && errorMessage && (
        <Alert intent="error">Audit Log konnte nicht geladen werden: {errorMessage}</Alert>
      )}
      <LogsTable
        logs={logs}
        loading={status === 'loading'}
        expanded={expanded}
        tenantBySlug={tenantBySlug}
        onToggleRow={onToggleRow}
        showEmptyState={status === 'ready' && logs.length === 0}
      />
      {status === 'ready' && total > 0 && (
        <Pagination
          pageNumber={pageNumber}
          totalPages={totalPages}
          total={total}
          canPrev={offset > 0}
          canNext={offset + PAGE_SIZE < total}
          onPrev={onPrev}
          onNext={onNext}
        />
      )}
    </div>
  );
}

type FilterBarProps = {
  tenantFilter: string;
  eventFilter: string;
  tenantOptions: { value: string; label: string }[];
  loading: boolean;
  onTenantChange: (v: string) => void;
  onEventChange: (v: string) => void;
  onApply: () => void;
};

function FilterBar(props: FilterBarProps) {
  const { tenantFilter, eventFilter, tenantOptions, loading, onTenantChange, onEventChange, onApply } = props;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 240 }}>
        <Select options={tenantOptions} value={tenantFilter} onChange={onTenantChange} placeholder="— Alle Tenants —" />
      </div>
      <div style={{ minWidth: 220 }}>
        <Select options={EVENT_TYPE_OPTIONS} value={eventFilter} onChange={onEventChange} placeholder="— Alle Events —" />
      </div>
      <Button variant="primary" onClick={onApply}>
        {loading ? 'Lade…' : 'Suchen'}
      </Button>
    </div>
  );
}

type LogsTableProps = {
  logs: AuditLogEntry[];
  loading: boolean;
  expanded: Set<string>;
  tenantBySlug: Map<string, string>;
  onToggleRow: (rowKey: string) => void;
  showEmptyState: boolean;
};

function LogsTable(props: LogsTableProps) {
  const { logs, loading, expanded, tenantBySlug, onToggleRow, showEmptyState } = props;
  return (
    <TableContainer style={{ maxHeight: '55vh' }}>
      <Table>
        <THead sticky>
          <Tr>
            <Th>Zeitstempel</Th>
            <Th>Tenant</Th>
            <Th>Event</Th>
            <Th>Source / Summary</Th>
            <Th>Details</Th>
          </Tr>
        </THead>
        <TBody>
          {loading && logs.length === 0 && <SkeletonRows />}
          {!loading && showEmptyState && (
            <Tr>
              <Td colSpan={5} style={{ textAlign: 'center', color: 'var(--fg-subtle)', padding: '32px 0' }}>
                Keine Audit-Log-Einträge gefunden.
              </Td>
            </Tr>
          )}
          {logs.map((log, idx) => {
            const rowKey = log.id ?? `row-${idx}`;
            return (
              <LogRow
                key={rowKey}
                log={log}
                expanded={expanded.has(rowKey)}
                tenantBySlug={tenantBySlug}
                onToggle={() => onToggleRow(rowKey)}
              />
            );
          })}
        </TBody>
      </Table>
    </TableContainer>
  );
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <Tr key={i}>
          <Td colSpan={5}>
            <div
              style={{
                height: 16,
                borderRadius: 4,
                background: 'var(--glass-hover)',
                animation: 'pulse 1.5s ease-in-out infinite',
                width: `${50 + i * 12}%`,
              }}
            />
          </Td>
        </Tr>
      ))}
    </>
  );
}

type LogRowProps = {
  log: AuditLogEntry;
  expanded: boolean;
  tenantBySlug: Map<string, string>;
  onToggle: () => void;
};

function getLogDetail(log: AuditLogEntry): string | null {
  const candidate = log.metadata ?? log.data ?? log.details;
  if (!candidate) return null;
  try {
    return JSON.stringify(candidate, null, 2);
  } catch {
    return null;
  }
}

function formatTimestamp(value?: string): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('de-DE');
  } catch {
    return value;
  }
}

function LogRow(props: LogRowProps) {
  const { log, expanded, tenantBySlug, onToggle } = props;
  const tenantSlug = log.tenantId ? tenantBySlug.get(log.tenantId) ?? log.tenantId : '—';
  const eventName = log.eventType || log.event || '—';
  const detailJson = getLogDetail(log);
  const timestamp = formatTimestamp(log.createdAt || log.timestamp);
  return (
    <>
      <Tr>
        <Td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{timestamp}</Td>
        <Td><Badge intent="primary">{tenantSlug}</Badge></Td>
        <Td><Badge intent="default">{eventName}</Badge></Td>
        <Td style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{log.source ?? '—'}</Td>
        <Td>
          {detailJson ? (
            <Button size="xs" onClick={onToggle}>
              {expanded ? 'Verbergen' : 'Details anzeigen'}
            </Button>
          ) : (
            <span style={{ color: 'var(--fg-subtle)' }}>—</span>
          )}
        </Td>
      </Tr>
      {expanded && detailJson && (
        <Tr>
          <Td colSpan={5}>
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: 'var(--glass)',
                borderRadius: 6,
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 320,
                overflow: 'auto',
              }}
            >
              {detailJson}
            </pre>
          </Td>
        </Tr>
      )}
    </>
  );
}

type PaginationProps = {
  pageNumber: number;
  totalPages: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
};

function Pagination(props: PaginationProps) {
  const { pageNumber, totalPages, total, canPrev, canNext, onPrev, onNext } = props;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
      <Button size="sm" disabled={!canPrev} onClick={onPrev}>Vorherige</Button>
      <span style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
        Seite {pageNumber} von {totalPages} ({total} Einträge)
      </span>
      <Button size="sm" disabled={!canNext} onClick={onNext}>Nächste</Button>
    </div>
  );
}

export default AuditLogAdmin;
