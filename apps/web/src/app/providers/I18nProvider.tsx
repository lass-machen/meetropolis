import * as React from 'react';
import i18n from './i18n';
import { I18nextProvider } from 'react-i18next';

export function I18nProvider(props: { children: React.ReactNode }) {
  return <I18nextProvider i18n={i18n}>{props.children}</I18nextProvider>;
}
