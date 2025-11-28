import React from 'react';
import { useTranslation } from 'react-i18next';

export function BubbleBanner(props: { active: boolean; members: string[]; onLeave: () => void }) {
  const { active, members, onLeave } = props;
  const { t } = useTranslation();
  if (!active) return null;
  return (
    <div style={{ 
      position: 'absolute', 
      bottom: 80, 
      left: 0, 
      right: 0, 
      zIndex: 40, 
      display: 'flex', 
      justifyContent: 'center',
      pointerEvents: 'none'
    }}>
      <div style={{ 
        pointerEvents: 'auto',
        display: 'flex', 
        alignItems: 'center', 
        gap: 12, 
        background: 'var(--glass, rgba(17,17,20,0.9))', 
        border: '1px solid var(--border, rgba(255,255,255,0.12))', 
        borderRadius: 'var(--radius, 12px)', 
        padding: '10px 16px', 
        color: 'var(--fg, #fff)', 
        boxShadow: 'var(--shadow, 0 12px 32px rgba(0,0,0,0.5))',
        backdropFilter: 'blur(12px)'
      }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{t('bubble.inWith')}</span>
        <span style={{ fontSize: 13 }}>{members.join(', ')}</span>
        <button 
          onClick={onLeave} 
          style={{ 
            marginLeft: 8, 
            padding: '6px 12px', 
            borderRadius: 'var(--radius-sm, 8px)', 
            border: '1px solid rgba(244,63,94,0.4)', 
            background: 'rgba(244,63,94,0.18)', 
            color: 'var(--fg, #fff)', 
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
            transition: 'background 0.15s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(244,63,94,0.3)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(244,63,94,0.18)'}
        >
          {t('bubble.leave')}
        </button>
      </div>
    </div>
  );
}


