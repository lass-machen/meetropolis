import * as React from 'react';
import { Root as RadixVisuallyHidden } from '@radix-ui/react-visually-hidden';

export type VisuallyHiddenProps = React.ComponentPropsWithoutRef<typeof RadixVisuallyHidden>;

export const VisuallyHidden = (props: VisuallyHiddenProps) => {
  return <RadixVisuallyHidden {...props} />;
};
