// Simple HUD panel showing zone, AV room and follow target
export function HudPanel(props: { hud: { zone?: string; avRoom?: string | null; follow?: string | null } }) {
  const { hud } = props;
  return (
    <div style={{ position: 'absolute', top: 12, left: 12, background: 'var(--panel-bg)', color: 'var(--panel-fg)', padding: '10px 12px', borderRadius: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5, backdropFilter: 'blur(8px)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', zIndex: 30 }}>
      <div>Zone: {hud.zone ?? '-'}</div>
      <div>AV: {hud.avRoom ?? 'lobby'}</div>
      <div>Following: {hud.follow ?? 'no'}</div>
    </div>
  );
}


