// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import i18n from '../../../app/providers/i18n';
import { AVBar } from '../AVBar';

type AVBarProps = ComponentProps<typeof AVBar>;

function renderAVBar(overrides?: Partial<AVBarProps>): void {
  const props: AVBarProps = {
    micOn: true,
    camOn: false,
    shareOn: false,
    dndOn: false,
    devices: { mics: [], cams: [] },
    selectedMicId: '',
    selectedCamId: '',
    onToggleMic: () => {},
    onSelectMic: () => {},
    onToggleCam: () => {},
    onSelectCam: () => {},
    onToggleShare: () => {},
    onToggleDnd: () => {},
    cameraManual: false,
    ...overrides,
  };
  render(<AVBar {...props} />);
}

describe('AVBar accessible names (de)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('names the microphone device chevron after the real av.selectMic string', () => {
    renderAVBar();
    expect(screen.getByRole('button', { name: 'Mic wählen…' })).toBeInTheDocument();
  });

  it('names the camera device chevron after the real av.selectCam string', () => {
    renderAVBar();
    expect(screen.getByRole('button', { name: 'Kamera wählen…' })).toBeInTheDocument();
  });

  it('names the camera toggle "Kamera einschalten" when the camera is off', () => {
    renderAVBar({ camOn: false });
    expect(screen.getByRole('button', { name: 'Kamera einschalten' })).toBeInTheDocument();
  });

  it('names the camera toggle "Kamera ausschalten" when the camera is on', () => {
    renderAVBar({ camOn: true });
    expect(screen.getByRole('button', { name: 'Kamera ausschalten' })).toBeInTheDocument();
  });

  it('names the mobile share button "Screenshare starten" when sharing is off', () => {
    renderAVBar({ shareOn: false });
    // jsdom does not evaluate the @media (max-width:700px) rule from
    // theme.css (the stylesheet is not loaded in unit tests either), so the
    // production mobile hide state is simulated on the real rendered span:
    // with the label visually hidden the accessible name must still resolve
    // from the call-site title. The media-query CSS engine itself is not
    // covered by this test.
    const spans = screen.getAllByText('Screenshare starten', { selector: 'span' });
    expect(spans).toHaveLength(1);
    const label = spans[0];
    label.style.display = 'none';
    expect(label).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Screenshare starten' })).toBeInTheDocument();
  });

  it('names the mobile share button "Screenshare stoppen" when sharing is on', () => {
    renderAVBar({ shareOn: true });
    // Same simulated mobile hide state as above; see comment there.
    const spans = screen.getAllByText('Screenshare stoppen', { selector: 'span' });
    expect(spans).toHaveLength(1);
    const label = spans[0];
    label.style.display = 'none';
    expect(label).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Screenshare stoppen' })).toBeInTheDocument();
  });
});
