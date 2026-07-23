import * as React from 'react';
import { Portal as RadixPortal } from '@radix-ui/react-portal';

export type PortalProps = React.ComponentPropsWithoutRef<typeof RadixPortal>;

export const Portal = (props: PortalProps) => {
  return <RadixPortal {...props} />;
};
