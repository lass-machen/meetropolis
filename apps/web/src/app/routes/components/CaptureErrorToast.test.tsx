import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { CaptureErrorToast } from './CaptureErrorToast';
import de from '../../../locales/de/common.json';
import en from '../../../locales/en/common.json';

async function renderToast(lng: 'de' | 'en', errorKey: string | null, onDismiss = vi.fn()) {
  const instance = i18next.createInstance();
  await instance.init({
    lng,
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common',
    resources: {
      de: { common: de },
      en: { common: en },
    },
  });
  render(
    <I18nextProvider i18n={instance}>
      <CaptureErrorToast errorKey={errorKey} onDismiss={onDismiss} />
    </I18nextProvider>,
  );
  return { onDismiss };
}

describe('CaptureErrorToast (Q-AV-2)', () => {
  it('rendert ohne Fehler nichts', async () => {
    await renderToast('de', null);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('zeigt deutschen Titel und Beschreibung mit Schließen-Button', async () => {
    await renderToast('de', 'av.microphoneCaptureFailed');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Aufnahme nicht gestartet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Das Mikrofon konnte nicht aktiviert werden. Prüfe die Mikrofonberechtigung und ob das Gerät verfügbar ist.',
      ),
    ).toBeInTheDocument();
  });

  it('zeigt den englischen Hinweis für die Kamera', async () => {
    await renderToast('en', 'av.cameraCaptureFailed');
    expect(screen.getByText('Capture did not start')).toBeInTheDocument();
    expect(screen.getByText(/camera could not be turned on/i)).toBeInTheDocument();
  });

  it('zeigt den deutschen Hinweis für die Bildschirmfreigabe', async () => {
    await renderToast('de', 'av.screenshareCaptureFailed');
    expect(
      screen.getByText(
        'Die Bildschirmfreigabe wurde nicht gestartet. Prüfe die Berechtigung zur Bildschirmaufnahme und wähle eine Freigabequelle aus.',
      ),
    ).toBeInTheDocument();
  });

  it('ruft onDismiss beim Schließen auf', async () => {
    const { onDismiss } = await renderToast('de', 'av.cameraCaptureFailed');
    fireEvent.click(screen.getByRole('button'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
