import * as React from 'react';
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from '../primitives/Dialog';
import { useTranslation } from 'react-i18next';

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
  draggable?: boolean;
};

export function Modal(props: ModalProps) {
  const { open, onOpenChange, title, description, right, children, footer, maxWidth = 600, zIndexBase, draggable } = props;
  const baseZ = typeof zIndexBase === 'number' ? zIndexBase : 1000;
  const { t } = useTranslation();
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const dragOriginRef = React.useRef<{ x: number; y: number } | null>(null);
  const startMouseRef = React.useRef<{ x: number; y: number } | null>(null);
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setPos(null);
      setDragging(false);
      dragOriginRef.current = null;
      startMouseRef.current = null;
    }
  }, [open]);

  React.useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!startMouseRef.current || !dragOriginRef.current) return;
      const dx = e.clientX - startMouseRef.current.x;
      const dy = e.clientY - startMouseRef.current.y;
      setPos({ x: dragOriginRef.current.x + dx, y: dragOriginRef.current.y + dy });
    };
    const onUp = () => { setDragging(false); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp as any);
    };
  }, [dragging]);

  const beginDrag = (e: React.MouseEvent) => {
    if (!draggable) return;
    const el = contentRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOriginRef.current = { x: rect.left, y: rect.top };
    startMouseRef.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
    // Ensure we switch to absolute coordinates
    if (!pos) setPos({ x: rect.left, y: rect.top });
    e.preventDefault();
  };
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay style={{ position: 'fixed', inset: 0, background:'rgba(0,0,0,0.68)', backdropFilter:'blur(4px)', WebkitBackdropFilter:'blur(4px)', zIndex: baseZ, pointerEvents:'auto', willChange:'opacity', contain:'layout paint style', transform:'translateZ(0)', WebkitBackfaceVisibility:'hidden' }} />
        <DialogContent
          ref={contentRef as any}
          style={{
            position: 'fixed',
            top: pos ? pos.y : '50%',
            left: pos ? pos.x : '50%',
            transform: pos ? 'translate(0, 0) translateZ(0)' : 'translate(-50%, -50%) translateZ(0)',
            width: `min(96vw, ${typeof maxWidth === 'number' ? maxWidth + 'px' : maxWidth})`,
            background: 'var(--glass)', color: 'var(--fg)', border: '1px solid var(--border)',
            borderRadius: 12, boxShadow: 'var(--shadow)', padding: 16, zIndex: baseZ + 1,
            maxHeight: '90vh', overflow: 'auto',
            willChange: 'transform, opacity', contain: 'layout paint style', WebkitBackfaceVisibility:'hidden'
          }}
        >
          {(title || description || right !== undefined) && (
            <div onMouseDown={beginDrag} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, cursor: draggable ? 'move' : undefined }}>
              <div>
                {title && <DialogTitle style={{ fontWeight: 800 }}>{title}</DialogTitle>}
                {description && <DialogDescription style={{ color: 'var(--fg-subtle)', fontSize: 12 }}>{description}</DialogDescription>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {right}
                <DialogClose asChild>
                  <button title={t('modal.close')} style={{ border: '1px solid var(--border)', background: 'var(--glass)', borderRadius: 'var(--radius-xs)', width: 32, height: 32, cursor: 'pointer' }}>×</button>
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


