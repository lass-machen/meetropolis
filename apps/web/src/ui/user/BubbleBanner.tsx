import React from 'react';

export function BubbleBanner(props: { active: boolean; members: string[]; onLeave: () => void }) {
  const { active, members, onLeave } = props;
  if (!active) return null;
  return (
    <div style={{ position: 'absolute', bottom: 140, left: '50%', transform: 'translateX(-50%)', zIndex: 40 }}>
      <div style={{ display:'flex', alignItems:'center', gap: 12, background:'rgba(17,17,20,0.9)', border:'1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 14px', color:'#fff', boxShadow:'0 12px 32px rgba(0,0,0,0.5)' }}>
        <span style={{ fontWeight:600 }}>In Bubble mit:</span>
        <span>{members.join(', ')}</span>
        <button onClick={onLeave} style={{ marginLeft: 8, padding:'6px 10px', borderRadius:8, border:'1px solid rgba(244,63,94,0.4)', background:'rgba(244,63,94,0.18)', color:'#fff', cursor:'pointer' }}>Bubble verlassen</button>
      </div>
    </div>
  );
}


