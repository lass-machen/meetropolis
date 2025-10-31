import * as React from 'react';
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from '../primitives/Dialog';

export type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: number | string;
  right?: React.ReactNode;
  zIndexBase?: number;
};

export function Modal(props: ModalProps) {
  const { open, onOpenChange, title, description, right, children, footer, maxWidth = 600, zIndexBase } = props;
  const baseZ = typeof zIndexBase === 'number' ? zIndexBase : 1000;
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay style={{ position: 'fixed', inset: 0, background:'rgba(0,0,0,0.55)', backdropFilter:'blur(2px)', WebkitBackdropFilter:'blur(2px)', zIndex: baseZ, pointerEvents:'auto', willChange:'opacity', contain:'layout paint style', transform:'translateZ(0)', WebkitBackfaceVisibility:'hidden' }} />
        <DialogContent
          onOpenAutoFocus={(e) => { e.preventDefault(); }}
          style={{
            position: 'fixed',
            top: '50%', left: '50%', transform: 'translate(-50%, -50%) translateZ(0)',
            width: `min(96vw, ${typeof maxWidth === 'number' ? maxWidth + 'px' : maxWidth})`,
            background: 'var(--glass)', color: 'var(--fg)', border: '1px solid var(--border)',
            borderRadius: 12, boxShadow: 'var(--shadow)', padding: 16, zIndex: baseZ + 1,
            willChange: 'transform, opacity', contain: 'layout paint style', WebkitBackfaceVisibility:'hidden'
          }}
        >
          {(title || description || right !== undefined) && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                {title && <DialogTitle style={{ fontWeight: 800 }}>{title}</DialogTitle>}
                {description && <DialogDescription style={{ color: 'var(--fg-subtle)', fontSize: 12 }}>{description}</DialogDescription>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {right}
                <DialogClose asChild>
                  <button title="Schließen" style={{ border: '1px solid var(--border)', background: 'var(--glass)', borderRadius: 'var(--radius-xs)', width: 32, height: 32, cursor: 'pointer' }}>×</button>
                </DialogClose>
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gap: 10 }}>
            {children}
          </div>
          {footer && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              {footer}
            </div>
          )}
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}


