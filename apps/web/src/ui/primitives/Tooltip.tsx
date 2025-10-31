import * as React from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';

export const TooltipProvider = RadixTooltip.Provider;
export const TooltipRoot = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;
export const TooltipPortal = RadixTooltip.Portal;
export const TooltipContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  function TooltipContent(props, ref) {
    return <RadixTooltip.Content ref={ref} {...props} />;
  }
);
export const TooltipArrow = RadixTooltip.Arrow;


