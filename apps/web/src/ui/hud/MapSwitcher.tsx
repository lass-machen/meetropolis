import * as React from 'react';
import { useMapStore } from '../../state/mapStore';
import { changeMap } from '../../game/map/changeMap';

interface MapSwitcherProps {
  room: { send: (type: string, data: unknown) => void; onMessage: (type: string, handler: (data: unknown) => void) => (() => void) } | null;
}

export function MapSwitcher({ room }: MapSwitcherProps) {
  const { currentMapName, availableMaps, isChangingMap } = useMapStore();

  if (availableMaps.length <= 1 || !room) return null;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const target = e.target.value;
    if (target && target !== currentMapName) {
      changeMap(target, room);
    }
  };

  return (
    <select
      value={currentMapName}
      onChange={handleChange}
      disabled={isChangingMap}
      style={{
        padding: '6px 12px',
        borderRadius: 'var(--radius-sm, 8px)',
        border: '1px solid rgba(255,255,255,0.15)',
        background: 'rgba(30,30,30,0.7)',
        backdropFilter: 'blur(12px)',
        color: '#fff',
        fontSize: 13,
        cursor: isChangingMap ? 'wait' : 'pointer',
        opacity: isChangingMap ? 0.6 : 1,
        outline: 'none',
      }}
      title="Map wechseln"
    >
      {availableMaps.map(m => (
        <option key={m.name} value={m.name}>{m.name}</option>
      ))}
    </select>
  );
}
