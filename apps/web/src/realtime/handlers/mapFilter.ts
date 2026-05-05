/**
 * Defensive Map-Filter-Helfer fuer Player-Sync.
 *
 * Wird verwendet, wenn der Server Players inkl. mapName broadcastet und der
 * Client nur die auf der eigenen Map rendern soll.
 *
 * Race-Hintergrund: useMapStore.currentMapName ist beim ersten full_state /
 * onStateChange noch nicht zwingend gesetzt. Wenn currentMap leer ist und der
 * Filter strikt auf Gleichheit prueft, fliegen ALLE Players raus, bis der
 * Store geladen ist. Aehnlich, wenn der Server p.mapName leer liefert (DB-
 * Race). Defensives Verhalten: bei mindestens einer leeren Seite den Player
 * durchlassen.
 */
export function passesMapFilter(playerMapName: string | undefined | null, currentMap: string | undefined | null): boolean {
  if (!currentMap) return true;
  if (!playerMapName) return true;
  return playerMapName === currentMap;
}
