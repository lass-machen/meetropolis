import { useMapStore } from '../../state/mapStore';

export function MapChangeOverlay() {
  const isChangingMap = useMapStore((s) => s.isChangingMap);

  if (!isChangingMap) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          color: '#fff',
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            border: '3px solid rgba(255,255,255,0.3)',
            borderTopColor: '#fff',
            borderRadius: '50%',
            animation: 'map-change-spin 0.8s linear infinite',
          }}
        />
        <span style={{ fontSize: 16, fontWeight: 500 }}>Map wird gewechselt...</span>
        <style>{`@keyframes map-change-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
