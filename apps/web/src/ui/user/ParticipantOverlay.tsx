import React from 'react';
import { ParticipantCard } from './ParticipantCard';

export type UIParticipant = { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number };

export function ParticipantOverlay(props: {
  participant: UIParticipant;
  roomGetter: () => any | undefined;
  zoom: number;
  onZoom: (next: number) => void;
  onClose: () => void;
}) {
  const { participant, roomGetter, zoom, onZoom, onClose } = props;
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 30, backdropFilter: 'blur(2px)' }} onClick={() => { onClose(); }}>
      <div style={{ position:'absolute', top: 24, bottom: 24, left: 24, right: 24, display: 'grid', placeItems: 'center', overflow: 'auto', borderRadius: 12 }} onWheel={(e)=>{ if (e.ctrlKey || e.metaKey) { e.preventDefault(); const dir = e.deltaY > 0 ? -0.1 : 0.1; onZoom(Math.max(0.25, Math.min(4, +(zoom+dir).toFixed(2)))); } }}>
        <ParticipantCard part={participant} roomGetter={roomGetter} compact={false} full zoom={zoom} />
      </div>
      <div style={{ position:'absolute', top: 24, right: 24, display:'flex', gap:8 }}>
        <button title="Zoom -" onClick={(e)=>{e.stopPropagation(); onZoom(Math.max(0.25, +(zoom-0.1).toFixed(2)));}} style={{ padding:6, width:32, height:32, borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.55)', color:'#fff' }}>-</button>
        <button title="Reset" onClick={(e)=>{e.stopPropagation(); onZoom(1);}} style={{ padding:6, width:32, height:32, borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.55)', color:'#fff' }}>1x</button>
        <button title="Zoom +" onClick={(e)=>{e.stopPropagation(); onZoom(Math.min(4, +(zoom+0.1).toFixed(2)));}} style={{ padding:6, width:32, height:32, borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.55)', color:'#fff' }}>+</button>
      </div>
    </div>
  );
}


