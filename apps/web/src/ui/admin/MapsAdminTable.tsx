import { useTranslation } from 'react-i18next';
import { Button, Badge, TableContainer, Table, THead, TBody, Tr, Th, Td } from '../system';

export type MapCounts = {
  rooms?: number;
  zones?: number;
  tilesets?: number;
  layers?: number;
  objects?: number;
};

export type MapRow = {
  id: string;
  name: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  counts: MapCounts;
  createdAt: string;
};

type MapsTableProps = {
  maps: MapRow[];
  loading: boolean;
  deletingId: string | null;
  onCopy: (m: MapRow) => void;
  onRequestDelete: (id: string) => void;
  onConfirmDelete: (id: string, name: string) => void;
  onCancelDelete: () => void;
};

export function MapsTable(props: MapsTableProps) {
  const { maps, loading, deletingId, onCopy, onRequestDelete, onConfirmDelete, onCancelDelete } = props;
  const { t } = useTranslation();
  return (
    <TableContainer style={{ maxHeight: '55vh' }}>
      <Table>
        <THead sticky>
          <Tr>
            <Th>{t('admin.maps.colName')}</Th>
            <Th>{t('admin.maps.colTenant')}</Th>
            <Th>{t('admin.maps.colSize')}</Th>
            <Th>{t('admin.maps.colRooms')}</Th>
            <Th>{t('admin.maps.colTilesets')}</Th>
            <Th>{t('admin.maps.colLayers')}</Th>
            <Th>{t('admin.maps.colObjects')}</Th>
            <Th>{t('admin.maps.colActions')}</Th>
          </Tr>
        </THead>
        <TBody>
          {loading && maps.length === 0 && <SkeletonRows />}
          {!loading && maps.length === 0 && (
            <Tr>
              <Td colSpan={8} style={{ textAlign: 'center', color: 'var(--fg-subtle)', padding: '32px 0' }}>
                {t('admin.maps.noMaps')}
              </Td>
            </Tr>
          )}
          {maps.map((m) => (
            <MapRowView
              key={m.id}
              map={m}
              isDeleting={deletingId === m.id}
              onCopy={() => onCopy(m)}
              onRequestDelete={() => onRequestDelete(m.id)}
              onConfirmDelete={() => onConfirmDelete(m.id, m.name)}
              onCancelDelete={onCancelDelete}
            />
          ))}
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
          <Td colSpan={8}>
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

type MapRowViewProps = {
  map: MapRow;
  isDeleting: boolean;
  onCopy: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
};

function MapRowView(props: MapRowViewProps) {
  const { map, isDeleting, onCopy, onRequestDelete, onConfirmDelete, onCancelDelete } = props;
  const { t } = useTranslation();
  return (
    <Tr>
      <Td>
        <div style={{ fontWeight: 600 }}>{map.name}</div>
      </Td>
      <Td>
        <Badge intent="primary">{map.tenantSlug}</Badge>
      </Td>
      <Td style={{ fontSize: 12 }}>
        {map.width}×{map.height} (tile {map.tileWidth}×{map.tileHeight})
      </Td>
      <Td style={{ textAlign: 'center' }}>{map.counts?.rooms ?? '—'}</Td>
      <Td style={{ textAlign: 'center' }}>{map.counts?.tilesets ?? '—'}</Td>
      <Td style={{ textAlign: 'center' }}>{map.counts?.layers ?? '—'}</Td>
      <Td style={{ textAlign: 'center' }}>{map.counts?.objects ?? '—'}</Td>
      <Td>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button size="xs" onClick={onCopy}>
            {t('admin.maps.copyRow')}
          </Button>
          {isDeleting ? (
            <>
              <Button size="xs" variant="danger" onClick={onConfirmDelete}>
                {t('admin.maps.confirmDelete')}
              </Button>
              <Button size="xs" onClick={onCancelDelete}>
                {t('admin.maps.cancel')}
              </Button>
            </>
          ) : (
            <Button size="xs" variant="danger" onClick={onRequestDelete}>
              {t('admin.maps.deleteRow')}
            </Button>
          )}
        </div>
      </Td>
    </Tr>
  );
}
