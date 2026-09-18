export const INTERNAL_MAP_LAYER_NAMES = ['collision_manual'] as const;

export const RESERVED_IMPORT_LAYER_NAMES = [...INTERNAL_MAP_LAYER_NAMES, 'walls_auto'] as const;

function normalizedLayerName(name: string): string {
  return name.trim().toLowerCase();
}

export function isInternalMapLayer(name: string): boolean {
  const normalized = normalizedLayerName(name);
  return INTERNAL_MAP_LAYER_NAMES.some((candidate) => candidate === normalized);
}

export function isReservedImportLayer(name: string): boolean {
  const normalized = normalizedLayerName(name);
  return RESERVED_IMPORT_LAYER_NAMES.some((candidate) => candidate === normalized);
}

export function importedLayerStorageName(name: string): string {
  return normalizedLayerName(name) === 'collision' ? INTERNAL_MAP_LAYER_NAMES[0] : name;
}
