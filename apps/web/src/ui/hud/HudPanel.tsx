// Simple HUD panel showing zone, AV room and follow target
import React from 'react';
import { useTranslation } from 'react-i18next';

export const HudPanel = React.memo(function HudPanel(props: { hud: { zone?: string; avRoom?: string | null; follow?: string | null } }) {
  const { hud } = props;
  const { t } = useTranslation();
  
  // Nur anzeigen wenn relevante Infos vorhanden (nicht alles "-" oder "no")
  const hasZone = hud.zone && hud.zone !== '-';
  const hasFollow = hud.follow && hud.follow !== 'no';
  const showPanel = hasZone || hasFollow;
  
  if (!showPanel) return null;
  
  return (
    <div style={{ 
      position: 'absolute', 
      top: 12, 
      left: 12, 
      background: 'var(--panel-bg)', 
      color: 'var(--panel-fg)', 
      padding: '8px 12px', 
      borderRadius: 'var(--radius-sm, 8px)', 
      fontSize: 11, 
      lineHeight: 1.6, 
      backdropFilter: 'blur(12px)', 
      border: '1px solid rgba(255,255,255,0.08)', 
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)', 
      zIndex: 30,
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      minWidth: 100,
    }}>
      {hasZone && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'rgba(229,231,235,0.5)', fontSize: 10 }}>{t('hud.zone')}</span>
          <span style={{ fontWeight: 600 }}>{hud.zone}</span>
        </div>
      )}
      {hasFollow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'rgba(229,231,235,0.5)', fontSize: 10 }}>{t('hud.following')}</span>
          <span style={{ fontWeight: 600, color: '#4ade80' }}>{hud.follow}</span>
        </div>
      )}
    </div>
  );
});


