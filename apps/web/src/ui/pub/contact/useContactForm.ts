import React from 'react';
import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/web/pbkdf2';
import type { Challenge, Payload } from 'altcha-lib/types';

/**
 * State and side effects for the public contact form.
 *
 * The proof-of-work is the part worth explaining. Solving it costs a second or
 * two, and making someone stare at a spinner after they press send would be a
 * poor trade for spam protection they never asked about. So the work starts as
 * soon as the visitor touches the form and runs while they type: by the time
 * they finish writing, the solution is normally already in hand and sending is
 * instant. `solveChallenge` awaits WebCrypto per attempt, which yields to the
 * event loop, so the page stays responsive throughout.
 *
 * A challenge is single-use on the server, and it is consumed *before* the
 * mail is handed to the provider — so a failed send burns it too. Every
 * submission attempt therefore ends by fetching and solving a fresh one,
 * rather than assuming the old one survived.
 */

export type ContactTopic = 'sales' | 'support' | 'demo' | 'other';

export interface ContactFormValues {
  name: string;
  email: string;
  company: string;
  topic: ContactTopic;
  message: string;
  privacyAccepted: boolean;
  /** Honeypot. Bound to a hidden input; a real visitor never sets it. */
  website: string;
}

/**
 * `unavailable` covers the deployment that never configured the form (the
 * routes 404) as well as an unreachable API. Both mean the same thing to a
 * visitor — use the mail address instead — so they are not distinguished.
 */
export type ContactFormStatus = 'checking' | 'unavailable' | 'ready' | 'submitting' | 'sent' | 'error';

/** Progress of the background proof-of-work, surfaced for the send button. */
export type ChallengeStatus = 'idle' | 'solving' | 'solved' | 'failed';

export const EMPTY_CONTACT_FORM: ContactFormValues = {
  name: '',
  email: '',
  company: '',
  topic: 'sales',
  message: '',
  privacyAccepted: false,
  website: '',
};

interface UseContactFormResult {
  values: ContactFormValues;
  setValue: <K extends keyof ContactFormValues>(field: K, value: ContactFormValues[K]) => void;
  status: ContactFormStatus;
  challengeStatus: ChallengeStatus;
  /** Set when `status` is 'error'; an i18n key, not a ready-made sentence. */
  errorKey: string | null;
  submit: () => void;
  /** Start the proof-of-work early, on first interaction with the form. */
  warmUp: () => void;
}

async function fetchChallenge(apiBase: string, signal: AbortSignal): Promise<Challenge | null> {
  const res = await fetch(`${apiBase}/public/contact/challenge`, { signal });
  if (!res.ok) return null;
  return (await res.json()) as Challenge;
}

/**
 * Fetch a challenge and solve it. Returns null when the form is unavailable or
 * the work could not be completed; callers treat both as "cannot submit".
 *
 * The controller is shared with the solver, so leaving the page stops the
 * proof-of-work loop instead of letting it run on a dead component.
 */
async function obtainSolvedPayload(apiBase: string, controller: AbortController): Promise<Payload | null> {
  const challenge = await fetchChallenge(apiBase, controller.signal);
  if (!challenge) return null;
  return solveExistingChallenge(challenge, controller);
}

/** Solve a challenge we already hold, without spending another request on it. */
async function solveExistingChallenge(challenge: Challenge, controller: AbortController): Promise<Payload | null> {
  const solution = await solveChallenge({ challenge, deriveKey, controller });
  if (!solution) return null;
  return { challenge, solution };
}

/** Map a failed submission to the i18n key the form should show. */
function errorKeyForStatus(status: number): string {
  if (status === 429) return 'contact.errorRateLimited';
  if (status === 502 || status === 503) return 'contact.errorDelivery';
  return 'contact.errorRejected';
}

interface ChallengeControl {
  /** Whether the endpoint answered at all, i.e. whether to offer the form. */
  available: boolean | null;
  challengeStatus: ChallengeStatus;
  /** Idempotent: starts a solve unless one is running or already done. */
  startSolving: () => Promise<Payload | null>;
  /** Forget the current solution, because the server has consumed it. */
  discard: () => void;
}

/**
 * Availability probe plus proof-of-work lifecycle, kept apart from the form
 * state it serves: one is about the endpoint, the other about what the visitor
 * typed, and they change for entirely different reasons.
 */
function useContactChallenge(apiBase: string): ChallengeControl {
  const [available, setAvailable] = React.useState<boolean | null>(null);
  const [challengeStatus, setChallengeStatus] = React.useState<ChallengeStatus>('idle');

  // The solved payload and the in-flight solve live in refs: they are consumed
  // by the submit handler and must not re-render the form on every change.
  const payloadRef = React.useRef<Payload | null>(null);
  const solvingRef = React.useRef<Promise<Payload | null> | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  /**
   * The challenge the availability probe already fetched, kept for the solver
   * instead of discarded. Asking again would double every visitor's cost
   * against the challenge budget for no benefit — the probe's answer is a
   * perfectly good, unspent challenge.
   */
  const probedRef = React.useRef<Challenge | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    // The probe decides whether the form is offered at all: the routes do not
    // exist unless the deployment configured a recipient.
    void fetchChallenge(apiBase, controller.signal)
      .then((challenge) => {
        if (controller.signal.aborted) return;
        probedRef.current = challenge;
        setAvailable(challenge !== null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailable(false);
      });
    return () => controller.abort();
  }, [apiBase]);

  const startSolving = React.useCallback((): Promise<Payload | null> => {
    if (payloadRef.current) return Promise.resolve(payloadRef.current);
    if (solvingRef.current) return solvingRef.current;

    setChallengeStatus('solving');
    const controller = abortRef.current ?? new AbortController();
    // Spend the probe's challenge first; every later solve fetches its own,
    // since a challenge is single-use on the server.
    const probed = probedRef.current;
    probedRef.current = null;
    const run = (probed ? solveExistingChallenge(probed, controller) : obtainSolvedPayload(apiBase, controller))
      .then((payload) => {
        payloadRef.current = payload;
        setChallengeStatus(payload ? 'solved' : 'failed');
        return payload;
      })
      .catch(() => {
        setChallengeStatus('failed');
        return null;
      })
      .finally(() => {
        solvingRef.current = null;
      });
    solvingRef.current = run;
    return run;
  }, [apiBase]);

  const discard = React.useCallback(() => {
    payloadRef.current = null;
    setChallengeStatus('idle');
  }, []);

  return { available, challengeStatus, startSolving, discard };
}

export function useContactForm(apiBase: string): UseContactFormResult {
  const [values, setValues] = React.useState<ContactFormValues>(EMPTY_CONTACT_FORM);
  const [status, setStatus] = React.useState<ContactFormStatus>('checking');
  const [errorKey, setErrorKey] = React.useState<string | null>(null);
  const { available, challengeStatus, startSolving, discard } = useContactChallenge(apiBase);

  React.useEffect(() => {
    // Only the initial probe moves the form out of 'checking'; later states
    // (submitting, sent, error) are owned by the submit handler.
    if (available !== null) setStatus((prev) => (prev === 'checking' ? (available ? 'ready' : 'unavailable') : prev));
  }, [available]);

  /**
   * Also runs after a failed or completed submission, not just on a fresh
   * form: both consume the challenge, so someone who corrects a rejected
   * message or writes a second one would otherwise wait out the full solve
   * at the moment they press send.
   */
  const warmUp = React.useCallback(() => {
    if (status === 'ready' || status === 'error' || status === 'sent') void startSolving();
  }, [status, startSolving]);

  const setValue = React.useCallback(<K extends keyof ContactFormValues>(field: K, value: ContactFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  }, []);

  const submit = React.useCallback(() => {
    void (async () => {
      setStatus('submitting');
      setErrorKey(null);

      // Whatever happens next, this payload is spent: the server consumes the
      // challenge before it attempts delivery.
      const payload = await startSolving();
      discard();

      if (!payload) {
        setStatus('error');
        setErrorKey('contact.errorChallenge');
        return;
      }

      try {
        const res = await fetch(`${apiBase}/public/contact`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: values.name,
            email: values.email,
            ...(values.company.trim() ? { company: values.company } : {}),
            topic: values.topic,
            message: values.message,
            privacyAccepted: values.privacyAccepted,
            website: values.website,
            altcha: payload,
          }),
        });

        if (!res.ok) {
          setStatus('error');
          setErrorKey(errorKeyForStatus(res.status));
          return;
        }

        setValues(EMPTY_CONTACT_FORM);
        setStatus('sent');
      } catch {
        setStatus('error');
        setErrorKey('contact.errorNetwork');
      }
    })();
  }, [apiBase, startSolving, discard, values]);

  return { values, setValue, status, challengeStatus, errorKey, submit, warmUp };
}
