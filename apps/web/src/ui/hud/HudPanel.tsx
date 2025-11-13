// Simple HUD panel showing zone, AV room and follow target
import React from 'react';
import { useTranslation } from 'react-i18next';

export const HudPanel = React.memo(function HudPanel(props: { hud: { zone?: string; avRoom?: string | null; follow?: string | null } }) {
  const { hud } = props;
  const { t } = useTranslation();
  return (
    <div style={{ position: 'absolute', top: 12, left: 12, background: 'var(--panel-bg)', color: 'var(--panel-fg)', padding: '10px 12px', borderRadius: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5, backdropFilter: 'blur(8px)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', zIndex: 30 }}>
      <div>{t('hud.zone')}: {hud.zone ?? '-'}</div>
      <div>{t('hud.av')}: {hud.avRoom ?? t('hud.lobby')}</div>
      <div>{t('hud.following')}: {hud.follow ?? t('hud.no')}</div>
    </div>
  );
});


