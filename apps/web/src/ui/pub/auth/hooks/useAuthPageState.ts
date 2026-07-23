import { useState } from 'react';
import type { AuthViewName } from './useAuthHandlers';
import type { RegistrationData } from '../AuthPageRenderer';

const INITIAL_REG_DATA: RegistrationData = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  teamName: '',
  teamSize: '1-10',
  slug: '',
  // Empty on purpose: `plan` doubles as the landing deep-link channel (it seeds
  // step 3's `initialTier`). A non-empty default here would be indistinguishable
  // from a real deep-link and would override the team-size recommendation as the
  // preselected plan. Left empty, step 3 falls through to the recommendation;
  // a genuine deep-link (below) or the user's step-3 pick fills it.
  plan: '',
};

export function useAuthPageState(initialView: AuthViewName, initialInvite: string | undefined, initialPlan?: string) {
  const [view, setView] = useState<AuthViewName>(initialView);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'error' | 'success'>('error');
  const [invite, setInvite] = useState(initialInvite || '');
  const [guestLoading, setGuestLoading] = useState(false);
  const [regStep, setRegStep] = useState(1);
  // A tier carried from the landing pricing cards preselects the plan in step 3;
  // absent that, `plan` stays empty so step 3 preselects the team-size
  // recommendation instead of a hardcoded default.
  const [regData, setRegData] = useState<RegistrationData>(
    initialPlan ? { ...INITIAL_REG_DATA, plan: initialPlan } : INITIAL_REG_DATA,
  );
  const [slugError, setSlugError] = useState<string | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);

  return {
    view,
    setView,
    error,
    setError,
    message,
    setMessage,
    messageType,
    setMessageType,
    invite,
    setInvite,
    guestLoading,
    setGuestLoading,
    regStep,
    setRegStep,
    regData,
    setRegData,
    slugError,
    setSlugError,
    submitLoading,
    setSubmitLoading,
  };
}
