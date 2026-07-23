import * as React from 'react';
import { AppProviders } from './AppProviders';

// RootProviders kapselt perspektivisch weitere Provider (z. B. Stores)
export function RootProviders(props: { children: React.ReactNode }) {
  return <AppProviders>{props.children}</AppProviders>;
}
