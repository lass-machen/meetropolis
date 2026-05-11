import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Select, Alert } from '../system';
import { logger } from '../../lib/logger';
import i18n from '../../app/providers/i18n';
import {
  CreateMapForm,
  ImportMapForm,
  CopyMapForm,
  type NewMapForm,
  type ImportForm,
  type CopyDialogState,
  type TenantSelectOption,
} from './MapsAdminForms';
import { MapsTable, type MapRow } from './MapsAdminTable';

type TenantOption = { id: string; slug: string; name: string };
type StatusMessage = { type: 'success' | 'error'; message: string };

const ALL_TENANTS = '__all__';
const PICK_TENANT = '__pick__';

const DEFAULT_NEW_MAP: NewMapForm = {
  tenantId: PICK_TENANT,
  name: '',
  width: 50,
  height: 50,
  tileWidth: 32,
  tileHeight: 32,
};
const DEFAULT_IMPORT: ImportForm = { tenantId: PICK_TENANT, name: '' };

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { credentials: 'include', ...init });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function useMapsState() {
  const [maps, setMaps] = React.useState<MapRow[]>([]);
  const [tenants, setTenants] = React.useState<TenantOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<StatusMessage | null>(null);
  const [filterTenantId, setFilterTenantId] = React.useState<string>(ALL_TENANTS);
  const [showCreate, setShowCreate] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);
  const [newMap, setNewMap] = React.useState<NewMapForm>(DEFAULT_NEW_MAP);
  const [importData, setImportData] = React.useState<ImportForm>(DEFAULT_IMPORT);
  const [importing, setImporting] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [copyDialog, setCopyDialog] = React.useState<CopyDialogState | null>(null);
  React.useEffect(() => {
    if (!deletingId) return;
    const t = setTimeout(() => setDeletingId(null), 3000);
    return () => clearTimeout(t);
  }, [deletingId]);
  React.useEffect(() => {
    if (status?.type !== 'success') return;
    const t = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(t);
  }, [status]);
  return {
    maps,
    tenants,
    loading,
    error,
    status,
    filterTenantId,
    showCreate,
    showImport,
    newMap,
    importData,
    importing,
    creating,
    deletingId,
    copyDialog,
    setMaps,
    setTenants,
    setLoading,
    setError,
    setStatus,
    setFilterTenantId,
    setShowCreate,
    setShowImport,
    setNewMap,
    setImportData,
    setImporting,
    setCreating,
    setDeletingId,
    setCopyDialog,
  };
}
type State = ReturnType<typeof useMapsState>;

function errorMessage(err: unknown): string {
  const detail = err instanceof Error ? err.message : i18n.t('admin.maps.unknownError');
  return i18n.t('admin.maps.errorPrefix', { message: detail });
}

function importErrorMessage(err: unknown): string {
  const detail = err instanceof Error ? err.message : i18n.t('admin.maps.unknownError');
  return i18n.t('admin.maps.importErrorPrefix', { message: detail });
}

async function createMap(apiBase: string, s: State, reload: () => Promise<void>) {
  if (!s.newMap.tenantId || s.newMap.tenantId === PICK_TENANT || !s.newMap.name.trim()) {
    s.setStatus({ type: 'error', message: i18n.t('admin.maps.tenantNameRequired') });
    return;
  }
  s.setCreating(true);
  try {
    await jsonFetch(`${apiBase}/admin/maps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s.newMap),
    });
    s.setStatus({ type: 'success', message: i18n.t('admin.maps.mapCreated', { name: s.newMap.name }) });
    s.setNewMap(DEFAULT_NEW_MAP);
    s.setShowCreate(false);
    await reload();
  } catch (err) {
    logger.warn('[MapsAdmin] Failed to create map', err);
    s.setStatus({ type: 'error', message: errorMessage(err) });
  } finally {
    s.setCreating(false);
  }
}

async function deleteMap(apiBase: string, s: State, reload: () => Promise<void>, id: string, name: string) {
  try {
    await jsonFetch(`${apiBase}/admin/maps/${id}`, { method: 'DELETE' });
    s.setStatus({ type: 'success', message: i18n.t('admin.maps.mapDeleted', { name }) });
    await reload();
  } catch (err) {
    logger.warn('[MapsAdmin] Failed to delete map', err);
    s.setStatus({ type: 'error', message: errorMessage(err) });
  } finally {
    s.setDeletingId(null);
  }
}

async function copyMap(apiBase: string, s: State, reload: () => Promise<void>) {
  if (!s.copyDialog) return;
  if (!s.copyDialog.targetTenantId || s.copyDialog.targetTenantId === PICK_TENANT) {
    s.setStatus({ type: 'error', message: i18n.t('admin.maps.targetTenantRequired') });
    return;
  }
  try {
    const body: { targetTenantId: string; newName?: string } = { targetTenantId: s.copyDialog.targetTenantId };
    if (s.copyDialog.newName.trim()) body.newName = s.copyDialog.newName.trim();
    await jsonFetch(`${apiBase}/admin/maps/${s.copyDialog.mapId}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    s.setStatus({ type: 'success', message: i18n.t('admin.maps.mapCopied') });
    s.setCopyDialog(null);
    await reload();
  } catch (err) {
    logger.warn('[MapsAdmin] Failed to copy map', err);
    s.setStatus({ type: 'error', message: errorMessage(err) });
  }
}

async function importMap(
  apiBase: string,
  s: State,
  reload: () => Promise<void>,
  e: React.ChangeEvent<HTMLInputElement>,
) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!s.importData.tenantId || s.importData.tenantId === PICK_TENANT || !s.importData.name.trim()) {
    s.setStatus({ type: 'error', message: i18n.t('admin.maps.uploadPrereq') });
    e.target.value = '';
    return;
  }
  s.setImporting(true);
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('tenantId', s.importData.tenantId);
    form.append('name', s.importData.name.trim());
    await jsonFetch(`${apiBase}/admin/maps/import`, { method: 'POST', body: form });
    s.setStatus({ type: 'success', message: i18n.t('admin.maps.mapImported', { name: s.importData.name }) });
    s.setImportData(DEFAULT_IMPORT);
    s.setShowImport(false);
    await reload();
  } catch (err) {
    logger.warn('[MapsAdmin] Failed to import map', err);
    s.setStatus({ type: 'error', message: importErrorMessage(err) });
  } finally {
    s.setImporting(false);
    e.target.value = '';
  }
}

type ToolbarProps = {
  loading: boolean;
  filterTenantId: string;
  filterOptions: TenantSelectOption[];
  onFilterChange: (value: string) => void;
  onReload: () => void;
  onToggleCreate: () => void;
  onToggleImport: () => void;
};

function Toolbar(props: ToolbarProps) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 240 }}>
        <Select
          options={props.filterOptions}
          value={props.filterTenantId}
          onChange={props.onFilterChange}
          placeholder={t('admin.maps.allTenants')}
        />
      </div>
      <div style={{ flex: 1 }} />
      <Button onClick={props.onReload}>{props.loading ? t('admin.maps.loadingShort') : t('admin.maps.reload')}</Button>
      <Button variant="primary" onClick={props.onToggleCreate}>
        {t('admin.maps.newMap')}
      </Button>
      <Button onClick={props.onToggleImport}>{t('admin.maps.importMap')}</Button>
    </div>
  );
}

export function MapsAdmin(props: { apiBase: string }) {
  const { apiBase } = props;
  const { t } = useTranslation();
  const state = useMapsState();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const reloadMaps = React.useCallback(async () => {
    state.setLoading(true);
    state.setError(null);
    try {
      state.setMaps(await jsonFetch<MapRow[]>(`${apiBase}/admin/maps`));
    } catch (err) {
      logger.warn('[MapsAdmin] Failed to load maps', err);
      state.setError(t('admin.maps.loadFailed'));
    } finally {
      state.setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: state setters are stable; only apiBase and t should refresh the callback
  }, [apiBase, t]);

  const reloadTenants = React.useCallback(async () => {
    try {
      state.setTenants(await jsonFetch<TenantOption[]>(`${apiBase}/admin/tenants`));
    } catch (err) {
      // OSS-Mode: /admin/tenants ist nur in der Enterprise-Edition registriert.
      // Fallback: lade den Single-Tenant via /tenant (Self-Service-Route).
      try {
        const own = await jsonFetch<TenantOption>(`${apiBase}/tenant`);
        if (own && own.id) state.setTenants([own]);
      } catch (fallbackErr) {
        logger.warn('[MapsAdmin] Failed to load tenants', err, fallbackErr);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: state setters are stable; only apiBase should refresh the callback
  }, [apiBase]);

  React.useEffect(() => {
    void reloadTenants();
    void reloadMaps();
  }, [reloadTenants, reloadMaps]);

  const filteredMaps = React.useMemo(
    () =>
      state.filterTenantId && state.filterTenantId !== ALL_TENANTS
        ? state.maps.filter((m) => m.tenantId === state.filterTenantId)
        : state.maps,
    [state.maps, state.filterTenantId],
  );

  const tenantOptions: TenantSelectOption[] = state.tenants.map((tenant) => ({
    value: tenant.id,
    label: `${tenant.slug} — ${tenant.name}`,
  }));
  const filterOptions: TenantSelectOption[] = [
    { value: ALL_TENANTS, label: t('admin.maps.allTenants') },
    ...tenantOptions,
  ];
  const tenantSelectOptions: TenantSelectOption[] = [
    { value: PICK_TENANT, label: t('admin.maps.pickTenant') },
    ...tenantOptions,
  ];

  return (
    <MapsAdminView
      state={state}
      filteredMaps={filteredMaps}
      filterOptions={filterOptions}
      tenantSelectOptions={tenantSelectOptions}
      fileInputRef={fileInputRef}
      onReload={() => {
        void reloadMaps();
      }}
      onCreate={() => {
        void createMap(apiBase, state, reloadMaps);
      }}
      onDelete={(id, name) => {
        void deleteMap(apiBase, state, reloadMaps, id, name);
      }}
      onCopy={() => {
        void copyMap(apiBase, state, reloadMaps);
      }}
      onImportFile={(e) => {
        void importMap(apiBase, state, reloadMaps, e);
      }}
    />
  );
}

type ViewProps = {
  state: State;
  filteredMaps: MapRow[];
  filterOptions: TenantSelectOption[];
  tenantSelectOptions: TenantSelectOption[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onReload: () => void;
  onCreate: () => void;
  onDelete: (id: string, name: string) => void;
  onCopy: () => void;
  onImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

function MapsAdminView(props: ViewProps) {
  const {
    state,
    filteredMaps,
    filterOptions,
    tenantSelectOptions,
    fileInputRef,
    onReload,
    onCreate,
    onDelete,
    onCopy,
    onImportFile,
  } = props;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Toolbar
        loading={state.loading}
        filterTenantId={state.filterTenantId}
        filterOptions={filterOptions}
        onFilterChange={state.setFilterTenantId}
        onReload={onReload}
        onToggleCreate={() => {
          state.setShowCreate(!state.showCreate);
          state.setShowImport(false);
        }}
        onToggleImport={() => {
          state.setShowImport(!state.showImport);
          state.setShowCreate(false);
        }}
      />
      {state.status && (
        <Alert intent={state.status.type === 'success' ? 'success' : 'error'} onDismiss={() => state.setStatus(null)}>
          {state.status.message}
        </Alert>
      )}
      {state.error && <Alert intent="error">{state.error}</Alert>}
      {state.showCreate && (
        <CreateMapForm
          tenantOptions={tenantSelectOptions}
          value={state.newMap}
          onChange={state.setNewMap}
          onSubmit={onCreate}
          onCancel={() => state.setShowCreate(false)}
          submitting={state.creating}
        />
      )}
      {state.showImport && (
        <ImportMapForm
          tenantOptions={tenantSelectOptions}
          value={state.importData}
          onChange={state.setImportData}
          onPickFile={() => fileInputRef.current?.click()}
          onCancel={() => state.setShowImport(false)}
          submitting={state.importing}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={onImportFile}
      />
      <MapsTable
        maps={filteredMaps}
        loading={state.loading}
        deletingId={state.deletingId}
        onCopy={(m) => state.setCopyDialog({ mapId: m.id, mapName: m.name, targetTenantId: m.tenantId, newName: '' })}
        onRequestDelete={(id) => state.setDeletingId(id)}
        onConfirmDelete={onDelete}
        onCancelDelete={() => state.setDeletingId(null)}
      />
      {state.copyDialog && (
        <CopyMapForm
          tenantOptions={tenantSelectOptions}
          dialog={state.copyDialog}
          onChange={(patch) => state.setCopyDialog(state.copyDialog ? { ...state.copyDialog, ...patch } : null)}
          onSubmit={onCopy}
          onCancel={() => state.setCopyDialog(null)}
        />
      )}
    </div>
  );
}

export default MapsAdmin;
