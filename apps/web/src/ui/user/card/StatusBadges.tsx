import { Icon } from '../../Icon';
import type { PartType } from './types';

export function StatusBadges({
  part,
  isVideoRendering,
  t,
}: {
  part: PartType;
  isVideoRendering: boolean;
  t: (k: string) => string;
}) {
  const isDnd = !!part.dnd;
  return (
    <>
      {isDnd && (
        <div
          title={t('participant.dnd')}
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 26,
            height: 26,
            borderRadius: 999,
            background: 'var(--uc-badge-off)',
            border: '1px solid var(--uc-badge-border-off)',
          }}
        >
          <Icon size="xs" name="moon" ariaLabel={t('participant.dnd')} />
        </div>
      )}
      <div
        title={part.hasMic ? t('participant.micOn') : t('participant.micOff')}
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 26,
          height: 26,
          borderRadius: 999,
          background: part.hasMic ? 'var(--uc-badge-on)' : 'var(--uc-badge-off)',
          border: `1px solid ${part.hasMic ? 'var(--uc-badge-border-on)' : 'var(--uc-badge-border-off)'}`,
        }}
      >
        <Icon
          size="xs"
          name={part.hasMic ? 'microphone' : 'microphone-off'}
          ariaLabel={part.hasMic ? t('participant.micOn') : t('participant.micOff')}
        />
      </div>
      <div
        title={part.hasVideo || isVideoRendering ? t('participant.camOn') : t('participant.camOff')}
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 26,
          height: 26,
          borderRadius: 999,
          background: part.hasVideo || isVideoRendering ? 'var(--uc-badge-on)' : 'var(--uc-badge-off)',
          border: `1px solid ${part.hasVideo || isVideoRendering ? 'var(--uc-badge-border-on)' : 'var(--uc-badge-border-off)'}`,
        }}
      >
        <Icon
          size="xs"
          name={part.hasVideo || isVideoRendering ? 'video' : 'video-off'}
          ariaLabel={part.hasVideo || isVideoRendering ? t('participant.camOn') : t('participant.camOff')}
        />
      </div>
    </>
  );
}
