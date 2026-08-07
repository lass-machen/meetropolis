// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { solveChallenge } from 'altcha-lib';
import type { Challenge } from 'altcha-lib/types';
import { ContactForm } from './ContactForm';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'de' },
  }),
}));

// The real solver spends CPU on PBKDF2 by design. These cases are about the
// form's behaviour around it — that it starts early, that it blocks sending
// when it fails — so the work itself is stubbed to a fixed answer.
vi.mock('altcha-lib', () => ({
  solveChallenge: vi.fn(() => Promise.resolve({ counter: 7, derivedKey: 'ab'.repeat(32) })),
}));
vi.mock('altcha-lib/algorithms/web/pbkdf2', () => ({ deriveKey: vi.fn() }));

/** `RequestInfo | URL` has no meaningful default stringification — unpack it. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Read back a request body the form serialised, or '' when there was none. */
function bodyOf(call: [RequestInfo | URL, RequestInit?] | undefined): Record<string, unknown> {
  const body = call?.[1]?.body;
  return typeof body === 'string' ? (JSON.parse(body) as Record<string, unknown>) : {};
}

const CHALLENGE: Challenge = {
  parameters: {
    algorithm: 'PBKDF2/SHA-256',
    nonce: 'a'.repeat(32),
    salt: 'b'.repeat(32),
    cost: 1,
    keyLength: 32,
    keyPrefix: 'cd',
  },
  signature: 'signature',
};

const API = 'https://api.example.test';

function mockFetch(handlers: { challenge?: () => Response; submit?: () => Response } = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    if (urlOf(input).endsWith('/public/contact/challenge')) {
      return Promise.resolve(handlers.challenge?.() ?? new Response(JSON.stringify(CHALLENGE), { status: 200 }));
    }
    return Promise.resolve(handlers.submit?.() ?? new Response(JSON.stringify({ success: true }), { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderForm() {
  return render(<ContactForm apiBase={API} fallbackEmail="mail@example.test" onNavigate={vi.fn()} />);
}

/** Fill every required field with something the server-side schema would accept. */
function fillValidly() {
  fireEvent.change(screen.getByLabelText('contact.fieldName'), { target: { value: 'Erika Mustermann' } });
  fireEvent.change(screen.getByLabelText('contact.fieldEmail'), { target: { value: 'erika@example.test' } });
  fireEvent.change(screen.getByLabelText('contact.fieldMessage'), {
    target: { value: 'Wir sind zwoelf Leute und wuerden das gern ausprobieren.' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ContactForm', () => {
  it('offers the form once the challenge endpoint answers', async () => {
    mockFetch();
    renderForm();

    await waitFor(() => expect(screen.getByLabelText('contact.fieldName')).toBeInTheDocument());
  });

  it('points at the fallback address when the endpoint is not configured', async () => {
    mockFetch({ challenge: () => new Response('Not Found', { status: 404 }) });
    renderForm();

    await waitFor(() => expect(screen.getByText('mail@example.test')).toBeInTheDocument());
    expect(screen.queryByLabelText('contact.fieldName')).toBeNull();
  });

  it('sends the filled form with the solved challenge', async () => {
    const fetchMock = mockFetch();
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('contact.fieldName')).toBeInTheDocument());

    fillValidly();
    fireEvent.submit(screen.getByRole('button', { name: /contact\.(send|preparing)/ }).closest('form')!);

    await waitFor(() => expect(screen.getByText('contact.sentTitle')).toBeInTheDocument());
    const body = bodyOf(fetchMock.mock.calls.find(([url]) => urlOf(url).endsWith('/public/contact')));
    expect(body.name).toBe('Erika Mustermann');
    expect(body.privacyAccepted).toBe(true);
    expect(body.altcha).toMatchObject({ solution: { counter: 7 } });
  });

  it('leaves the honeypot empty in a normal submission', async () => {
    const fetchMock = mockFetch();
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('contact.fieldName')).toBeInTheDocument());

    fillValidly();
    fireEvent.submit(screen.getByRole('button', { name: /contact\./ }).closest('form')!);

    await waitFor(() => expect(screen.getByText('contact.sentTitle')).toBeInTheDocument());
    const body = bodyOf(fetchMock.mock.calls.find(([url]) => urlOf(url).endsWith('/public/contact')));
    expect(body.website).toBe('');
  });

  it('starts the proof-of-work on first interaction, not on send', async () => {
    mockFetch();
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('contact.fieldName')).toBeInTheDocument());

    fireEvent.focus(screen.getByLabelText('contact.fieldName'));

    // Solving begins while the visitor is still filling in the form, which is
    // the whole point of the warm-up: the cost is paid before they press send.
    await waitFor(() => expect(vi.mocked(solveChallenge)).toHaveBeenCalled());
  });

  /**
   * A shared office IP shares one challenge budget, so every avoidable request
   * is one a colleague cannot make. The availability probe already holds a
   * perfectly good challenge — spending a second one on the solve locked real
   * visitors out in production.
   */
  it('reuses the probe challenge instead of fetching a second one', async () => {
    const fetchMock = mockFetch();
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('contact.fieldName')).toBeInTheDocument());

    fireEvent.focus(screen.getByLabelText('contact.fieldName'));
    await waitFor(() => expect(vi.mocked(solveChallenge)).toHaveBeenCalled());

    const challengeCalls = fetchMock.mock.calls.filter(([u]) => urlOf(u).endsWith('/challenge'));
    expect(challengeCalls).toHaveLength(1);
  });

  /**
   * A green line under the button read as one more hint among several, and the
   * emptied form standing there invited a duplicate send. The confirmation
   * replaces the form instead.
   */
  it('replaces the form with a confirmation once the message is sent', async () => {
    mockFetch();
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('contact.fieldName')).toBeInTheDocument());

    fillValidly();
    fireEvent.submit(screen.getByRole('button', { name: /contact\./ }).closest('form')!);

    await waitFor(() => expect(screen.getByText('contact.sentTitle')).toBeInTheDocument());
    expect(screen.queryByLabelText('contact.fieldName')).toBeNull();
    expect(screen.getByText('contact.sentBody')).toBeInTheDocument();
  });

  it('offers an empty form again after the confirmation', async () => {
    mockFetch();
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('contact.fieldName')).toBeInTheDocument());

    fillValidly();
    fireEvent.submit(screen.getByRole('button', { name: /contact\./ }).closest('form')!);
    await waitFor(() => expect(screen.getByText('contact.sentTitle')).toBeInTheDocument());

    fireEvent.click(screen.getByText('contact.sendAnother'));

    const name = await screen.findByLabelText('contact.fieldName');
    expect((name as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('contact.sentTitle')).toBeNull();
  });

  it('reports a rejected submission instead of claiming success', async () => {
    mockFetch({ submit: () => new Response('{}', { status: 400 }) });
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('contact.fieldName')).toBeInTheDocument());

    fillValidly();
    fireEvent.submit(screen.getByRole('button', { name: /contact\./ }).closest('form')!);

    await waitFor(() => expect(screen.getByText('contact.errorRejected')).toBeInTheDocument());
    expect(screen.queryByText('contact.sentTitle')).toBeNull();
  });

  it('distinguishes a rate-limited attempt from a rejected one', async () => {
    mockFetch({ submit: () => new Response('{}', { status: 429 }) });
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('contact.fieldName')).toBeInTheDocument());

    fillValidly();
    fireEvent.submit(screen.getByRole('button', { name: /contact\./ }).closest('form')!);

    await waitFor(() => expect(screen.getByText('contact.errorRateLimited')).toBeInTheDocument());
  });

  it('says delivery failed rather than sent when the mail was dropped', async () => {
    mockFetch({ submit: () => new Response('{}', { status: 502 }) });
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('contact.fieldName')).toBeInTheDocument());

    fillValidly();
    fireEvent.submit(screen.getByRole('button', { name: /contact\./ }).closest('form')!);

    await waitFor(() => expect(screen.getByText('contact.errorDelivery')).toBeInTheDocument());
  });

  it('fetches a fresh challenge for a retry, because the first one is spent', async () => {
    const fetchMock = mockFetch({ submit: () => new Response('{}', { status: 502 }) });
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('contact.fieldName')).toBeInTheDocument());

    fillValidly();
    const form = screen.getByRole('button', { name: /contact\./ }).closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText('contact.errorDelivery')).toBeInTheDocument());

    const countChallenges = () => fetchMock.mock.calls.filter(([u]) => urlOf(u).endsWith('/challenge')).length;
    const challengeCallsBefore = countChallenges();
    fireEvent.submit(form);

    await waitFor(() => expect(countChallenges()).toBeGreaterThan(challengeCallsBefore));
  });

  it('does not submit when the network is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (urlOf(input).endsWith('/challenge')) {
          return Promise.resolve(new Response(JSON.stringify(CHALLENGE), { status: 200 }));
        }
        return Promise.reject(new TypeError('network down'));
      }),
    );
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('contact.fieldName')).toBeInTheDocument());

    fillValidly();
    fireEvent.submit(screen.getByRole('button', { name: /contact\./ }).closest('form')!);

    await waitFor(() => expect(screen.getByText('contact.errorNetwork')).toBeInTheDocument());
  });
});
