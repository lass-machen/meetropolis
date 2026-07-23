/**
 * Defensive map-filter helper for player sync.
 *
 * Used when the server broadcasts players including mapName and the client
 * should only render the ones on its own map.
 *
 * Race background: useMapStore.currentMapName is not necessarily set during
 * the first full_state / onStateChange. If currentMap is empty and the filter
 * checks strict equality, ALL players are dropped until the store is loaded.
 * Similarly, when the server delivers an empty p.mapName (DB race). Defensive
 * behaviour: if at least one side is empty, let the player through.
 */
export function passesMapFilter(
  playerMapName: string | undefined | null,
  currentMap: string | undefined | null,
): boolean {
  if (!currentMap) return true;
  if (!playerMapName) return true;
  return playerMapName === currentMap;
}
