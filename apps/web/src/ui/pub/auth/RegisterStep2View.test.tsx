// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RegisterStep2View } from './RegisterStep2View';
import { usePublicConfigStore } from '../../../state/publicConfigStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : k),
    i18n: { language: 'de' },
  }),
}));

// These tests cover the OSS (self-host) path with static headcount buckets and
// no catalog fetch. Force billing off so the concurrency-derived options and
// their catalog fetch stay out of the slug-derivation assertions.
beforeEach(() => {
  usePublicConfigStore.setState({ billingEnabled: false, loaded: true });
});

const API = 'http://api.test';

/** The team-name box and the workspace-identifier box, in DOM order. */
function fields() {
  const inputs = screen.getAllByRole('textbox');
  return { teamName: inputs[0], slug: inputs[1] };
}

describe('RegisterStep2View — workspace identifier derivation', () => {
  it('derives the identifier from the team name as it is typed', () => {
    render(<RegisterStep2View apiBase={API} onNext={vi.fn()} onBack={vi.fn()} />);
    const { teamName, slug } = fields();

    fireEvent.change(teamName, { target: { value: 'Acme Corp' } });
    expect((slug as HTMLInputElement).value).toBe('acme-corp');
  });

  it('keeps following the team name while the identifier is untouched', () => {
    render(<RegisterStep2View apiBase={API} onNext={vi.fn()} onBack={vi.fn()} />);
    const { teamName, slug } = fields();

    fireEvent.change(teamName, { target: { value: 'Acme' } });
    fireEvent.change(teamName, { target: { value: 'Acme Corp GmbH' } });
    expect((slug as HTMLInputElement).value).toBe('acme-corp-gmbh');
  });

  it('stops overwriting once the user edits the identifier themselves', () => {
    render(<RegisterStep2View apiBase={API} onNext={vi.fn()} onBack={vi.fn()} />);
    const { teamName, slug } = fields();

    fireEvent.change(teamName, { target: { value: 'Acme Corp' } });
    fireEvent.change(slug, { target: { value: 'acme' } });
    fireEvent.change(teamName, { target: { value: 'Totally Different Name' } });

    expect((slug as HTMLInputElement).value).toBe('acme');
  });

  it('respects a cleared identifier as a deliberate choice', () => {
    render(<RegisterStep2View apiBase={API} onNext={vi.fn()} onBack={vi.fn()} />);
    const { teamName, slug } = fields();

    fireEvent.change(teamName, { target: { value: 'Acme' } });
    fireEvent.change(slug, { target: { value: '' } });
    fireEvent.change(teamName, { target: { value: 'Acme Corp' } });

    expect((slug as HTMLInputElement).value).toBe('');
  });

  it('does not clobber an identifier carried in from a previous step', () => {
    render(
      <RegisterStep2View
        apiBase={API}
        onNext={vi.fn()}
        onBack={vi.fn()}
        initialData={{ teamName: 'Acme', slug: 'chosen-one' }}
      />,
    );
    const { teamName, slug } = fields();

    fireEvent.change(teamName, { target: { value: 'Acme Corp' } });
    expect((slug as HTMLInputElement).value).toBe('chosen-one');
  });

  it('submits the derived identifier without the user touching the field', () => {
    const onNext = vi.fn();
    render(<RegisterStep2View apiBase={API} onNext={onNext} onBack={vi.fn()} />);
    const { teamName } = fields();

    fireEvent.change(teamName, { target: { value: 'Zweitläufer' } });
    fireEvent.click(screen.getByText('auth.registerSubmit'));

    expect(onNext).toHaveBeenCalledWith({ teamName: 'Zweitläufer', teamSize: '1-10', slug: 'zweitlaeufer' });
  });
});
