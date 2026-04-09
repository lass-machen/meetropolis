import React from 'react';
import { Button, Select, Alert } from '../system';
import { logger } from '../../lib/logger';
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
    const err = await res.json().catch(() => ({}));
    throw new Error((err && err.error) || `HTTP ${res.status}`);
  }
  return res.json();
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
    maps, tenants, loading, error, status, filterTenantId, showCreate, showImport,
    newMap, importData, importing, creating, deletingId, copyDialog,
    setMaps, setTenants, setLoading, setError, setStatus, setFilterTenantId,
    setShowCreate, setShowImport, setNewMap, setImportData, setImporting,
    setCreating, setDeletingId, setCopyDialog,
  };
}
type State = ReturnType<typeof useMapsState>;

async function createMap(apiBase: string, s: State, reload: () => Promise<void>) {
  if (!s.newMap.tenantId || s.newMap.tenantId === PICK_TENANT || !s.newMap.name.trim()) {
    s.setStatus({ type: 'error', message: 'Tenant und Name sind erforderlich.' });
    return;
  }
  s.setCreating(true);
  try {
    await jsonFetch(`${apiBase}/admin/maps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s.newMap),
    });
    s.setStatus({ type: 'success', message: `Map "${s.newMap.name}" erstellt.` });
    s.setNewMap(DEFAULT_NEW_MAP);
    s.setShowCreate(false);
    await reload();
  } catch (err) {
    logger.warn('[MapsAdmin] Failed to create map', err);
    s.setStatus({ type: 'error', message: `Fehler: ${err instanceof Error ? err.message : 'Unbekannt'}` });
  } finally {
    s.setCreating(false);
  }
}

async function deleteMap(apiBase: string, s: State, reload: () => Promise<void>, id: string, name: string) {
  try {
    await jsonFetch(`${apiBase}/admin/maps/${id}`, { method: 'DELETE' });
    s.setStatus({ type: 'success', message: `Map "${name}" gelöscht.` });
    await reload();
  } catch (err) {
    logger.warn('[MapsAdmin] Failed to delete map', err);
    s.setStatus({ type: 'error', message: `Fehler: ${err instanceof Error ? err.message : 'Unbekannt'}` });
  } finally {
    s.setDeletingId(null);
  }
}

async function copyMap(apiBase: string, s: State, reload: () => Promise<void>) {
  if (!s.copyDialog) return;
  if (!s.copyDialog.targetTenantId || s.copyDialog.targetTenantId === PICK_TENANT) {
    s.setStatus({ type: 'error', message: 'Ziel-Tenant erforderlich.' });
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
    s.setStatus({ type: 'success', message: 'Map kopiert.' });
    s.setCopyDialog(null);
    await reload();
  } catch (err) {
    logger.warn('[MapsAdmin] Failed to copy map', err);
    s.setStatus({ type: 'error', message: `Fehler: ${err instanceof Error ? err.message : 'Unbekannt'}` });
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
    s.setStatus({ type: 'error', message: 'Tenant und Map-Name müssen vor dem Upload gesetzt sein.' });
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
    s.setStatus({ type: 'success', message: `Map "${s.importData.name}" importiert.` });
    s.setImportData(DEFAULT_IMPORT);
    s.setShowImport(false);
    await reload();
  } catch (err) {
    logger.warn('[MapsAdmin] Failed to import map', err);
    s.setStatus({ type: 'error', message: `Import-Fehler: ${err instanceof Error ? err.message : 'Unbekannt'}` });
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
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 240 }}>
        <Select
          options={props.filterOptions}
          value={props.filterTenantId}
          onChange={props.onFilterChange}
          placeholder="— Alle Tenants —"
        />
      </div>
      <div style={{ flex: 1 }} />
      <Button onClick={props.onReload}>{props.loading ? 'Lade…' : 'Neu laden'}</Button>
      <Button variant="primary" onClick={props.onToggleCreate}>+ Neue Map</Button>
      <Button onClick={props.onToggleImport}>Map importieren</Button>
    </div>
  );
}

export function MapsAdmin(props: { apiBase: string }) {
  const { apiBase } = props;
  const state = useMapsState();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const reloadMaps = React.useCallback(async () => {
    state.setLoading(true);
    state.setError(null);
    try {
      state.setMaps(await jsonFetch<MapRow[]>(`${apiBase}/admin/maps`));
    } catch (err) {
      logger.warn('[MapsAdmin] Failed to load maps', err);
      state.setError('Maps konnten nicht geladen werden.');
    } finally {
      state.setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  const reloadTenants = React.useCallback(async () => {
    try {
      state.setTenants(await jsonFetch<TenantOption[]>(`${apiBase}/admin/tenants`));
    } catch (err) {
      logger.warn('[MapsAdmin] Failed to load tenants', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const tenantOptions: TenantSelectOption[] = state.tenants.map((t) => ({ value: t.id, label: `${t.slug} — ${t.name}` }));
  const filterOptions: TenantSelectOption[] = [{ value: ALL_TENANTS, label: '— Alle Tenants —' }, ...tenantOptions];
  const tenantSelectOptions: TenantSelectOption[] = [{ value: PICK_TENANT, label: '— Tenant wählen —' }, ...tenantOptions];

  return (
    <MapsAdminView
      state={state}
      filteredMaps={filteredMaps}
      filterOptions={filterOptions}
      tenantSelectOptions={tenantSelectOptions}
      fileInputRef={fileInputRef}
      onReload={reloadMaps}
      onCreate={() => createMap(apiBase, state, reloadMaps)}
      onDelete={(id, name) => deleteMap(apiBase, state, reloadMaps, id, name)}
      onCopy={() => copyMap(apiBase, state, reloadMaps)}
      onImportFile={(e) => importMap(apiBase, state, reloadMaps, e)}
    />
  );
}

type ViewProps = {
  state: State;
  filteredMaps: MapRow[];
  filterOptions: TenantSelectOption[];
  tenantSelectOptions: TenantSelectOption[];
  fileInputRef: React.RefObject<HTMLInputElement>;
  onReload: () => void;
  onCreate: () => void;
  onDelete: (id: string, name: string) => void;
  onCopy: () => void;
  onImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

function MapsAdminView(props: ViewProps) {
  const {
    state, filteredMaps, filterOptions, tenantSelectOptions,
    fileInputRef, onReload, onCreate, onDelete, onCopy, onImportFile,
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
      <input ref={fileInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportFile} />
      <MapsTable
        maps={filteredMaps}
        loading={state.loading}
        deletingId={state.deletingId}
        onCopy={(m) =>
          state.setCopyDialog({ mapId: m.id, mapName: m.name, targetTenantId: m.tenantId, newName: '' })
        }
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
