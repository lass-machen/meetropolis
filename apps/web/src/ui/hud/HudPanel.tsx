// Simple HUD panel showing zone, AV room and follow target
export function HudPanel(props: { hud: { zone?: string; avRoom?: string | null; follow?: string | null } }) {
  const { hud } = props;
  return (
    <div style={{ position: 'absolute', top: 12, left: 12, background: 'var(--glass)', color: 'var(--fg)', padding: 8, borderRadius: 8, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, backdropFilter: 'blur(6px)', border: '1px solid var(--border)' }}>
      <div>Zone: {hud.zone ?? '-'}</div>
      <div>AV: {hud.avRoom ?? 'lobby'}</div>
      <div>Following: {hud.follow ?? 'no'}</div>
    </div>
  );
}


