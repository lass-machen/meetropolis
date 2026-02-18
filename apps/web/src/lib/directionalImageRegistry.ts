/**
 * DirectionalImageRegistry - Singleton lookup cache for directional images
 *
 * Maps (packUuid, itemId) to an array of rotation-specific images.
 * When an object has a directional image for a given rotation, it should be
 * used instead of programmatic rotation.
 */

export type DirectionalEntry = { rotation: number; dataURL: string };

const registry = new Map<string, DirectionalEntry[]>();

function makeKey(packUuid: string, itemId: string): string {
  return `${packUuid}:${itemId}`;
}

/**
 * Populate the registry from the GET /asset-packs response.
 * Iterates over packs' objects that have a `directionalImages` array.
 */
export function loadFromPacks(packs: any[]): void {
  registry.clear();
  for (const p of packs) {
    const uuid = p.uuid;
    if (!uuid) continue;
    for (const obj of (p.objects || [])) {
      if (Array.isArray(obj.directionalImages) && obj.directionalImages.length > 0) {
        registry.set(makeKey(uuid, obj.id), obj.directionalImages);
      }
    }
  }
}

/**
 * Look up a directional image for a specific rotation.
 * Returns the dataURL if found, or null if no directional image exists.
 */
export function lookupDirectionalImage(
  packUuid: string,
  itemId: string,
  rotation: number,
): string | null {
  const entries = registry.get(makeKey(packUuid, itemId));
  if (!entries) return null;
  const match = entries.find(e => e.rotation === rotation);
  return match?.dataURL ?? null;
}

/**
 * Check whether an item has any directional images registered.
 */
export function hasDirectionalImages(packUuid: string, itemId: string): boolean {
  return registry.has(makeKey(packUuid, itemId));
}

/**
 * Clear the entire registry.
 */
export function clearRegistry(): void {
  registry.clear();
}
