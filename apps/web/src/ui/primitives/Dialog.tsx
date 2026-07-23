import * as React from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';

export type DialogProps = React.ComponentPropsWithoutRef<typeof RadixDialog.Root>;

export const DialogRoot = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogPortal = RadixDialog.Portal;
export const DialogOverlay = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  function DialogOverlay(props, ref) {
    return <RadixDialog.Overlay ref={ref} {...props} />;
  },
);

export const DialogContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  function DialogContent(props, ref) {
    return <RadixDialog.Content ref={ref} {...props} />;
  },
);

export const DialogTitle = RadixDialog.Title;
export const DialogDescription = RadixDialog.Description;
export const DialogClose = RadixDialog.Close;

// Controlled usage example (for reference):
// <DialogRoot open={open} onOpenChange={setOpen}>
//   <DialogTrigger asChild><button>Open</button></DialogTrigger>
//   <DialogPortal>
//     <DialogOverlay />
//     <DialogContent>...</DialogContent>
//   </DialogPortal>
// </DialogRoot>
