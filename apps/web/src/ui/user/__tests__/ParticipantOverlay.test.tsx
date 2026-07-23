import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ParticipantOverlay, type UIParticipant } from '../ParticipantOverlay';

// The card pulls in LiveKit track attachment; the overlay tests only cover
// wheel handling and the fixed zoom controls.
vi.mock('../ParticipantCard', () => ({
  ParticipantCard: () => <div data-testid="participant-card" />,
}));

const participant: UIParticipant = {
  sid: 'sid-1',
  identity: 'alice',
  hasVideo: true,
  hasMic: true,
  isSpeaking: false,
  media: 'screen',
};

function renderOverlay(zoom: number) {
  const onZoom = vi.fn();
  const onClose = vi.fn();
  render(
    <ParticipantOverlay
      participant={participant}
      roomGetter={() => undefined}
      zoom={zoom}
      onZoom={onZoom}
      onClose={onClose}
    />,
  );
  return { onZoom, onClose, stage: screen.getByTestId('overlay-stage') };
}

describe('ParticipantOverlay wheel handling', () => {
  it('ignores plain wheel events at zoom 1', () => {
    const { onZoom, stage } = renderOverlay(1);
    fireEvent.wheel(stage, { deltaY: -3 });
    fireEvent.wheel(stage, { deltaY: 2 });
    fireEvent.wheel(stage, { deltaY: -1 });
    expect(onZoom).not.toHaveBeenCalled();
  });

  it('zooms proportionally on ctrl+wheel (pinch gesture)', () => {
    const { onZoom, stage } = renderOverlay(1);
    fireEvent.wheel(stage, { deltaY: -100, ctrlKey: true });
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onZoom.mock.calls[0][0]).toBeCloseTo(Math.exp(0.2), 5);
  });

  it('clamps ctrl+wheel zoom at the lower bound', () => {
    const { onZoom, stage } = renderOverlay(0.3);
    fireEvent.wheel(stage, { deltaY: 10000, ctrlKey: true });
    expect(onZoom).toHaveBeenCalledWith(0.25);
  });

  it('does not zoom on plain wheel while zoomed in (pans instead)', () => {
    const { onZoom, stage } = renderOverlay(2);
    fireEvent.wheel(stage, { deltaY: 40, deltaX: -10 });
    expect(onZoom).not.toHaveBeenCalled();
  });
});

describe('ParticipantOverlay fixed controls', () => {
  it('steps the zoom via the plus and minus buttons', () => {
    const { onZoom } = renderOverlay(1);
    fireEvent.click(screen.getByTitle('participant.zoomPlus (+)'));
    expect(onZoom).toHaveBeenLastCalledWith(1.25);
    fireEvent.click(screen.getByTitle('participant.zoomMinus (-)'));
    expect(onZoom).toHaveBeenLastCalledWith(0.75);
  });

  it('shows the current zoom percentage', () => {
    renderOverlay(1.5);
    expect(screen.getByText('150%')).toBeInTheDocument();
  });

  it('resets to fit via the fit button', () => {
    const { onZoom } = renderOverlay(3);
    fireEvent.click(screen.getByTitle('participant.fit (0)'));
    expect(onZoom).toHaveBeenLastCalledWith(1);
  });

  it('closes via the close button', () => {
    const { onClose } = renderOverlay(1);
    fireEvent.click(screen.getByTitle('common.close (Esc)'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
