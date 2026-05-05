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
  plan: 'team',
};

export function useAuthPageState(initialView: AuthViewName, initialInvite: string | undefined) {
  const [view, setView] = useState<AuthViewName>(initialView);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'error' | 'success'>('error');
  const [invite, setInvite] = useState(initialInvite || '');
  const [guestLoading, setGuestLoading] = useState(false);
  const [regStep, setRegStep] = useState(1);
  const [regData, setRegData] = useState<RegistrationData>(INITIAL_REG_DATA);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);

  return {
    view, setView,
    error, setError,
    message, setMessage,
    messageType, setMessageType,
    invite, setInvite,
    guestLoading, setGuestLoading,
    regStep, setRegStep,
    regData, setRegData,
    slugError, setSlugError,
    submitLoading, setSubmitLoading,
  };
}
