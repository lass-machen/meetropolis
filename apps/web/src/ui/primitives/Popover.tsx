import * as React from 'react';
import * as RadixPopover from '@radix-ui/react-popover';

export const PopoverRoot = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverPortal = RadixPopover.Portal;
export const PopoverContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  function PopoverContent(props, ref) {
    return <RadixPopover.Content ref={ref} {...props} />;
  }
);
export const PopoverArrow = RadixPopover.Arrow;


