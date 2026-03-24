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
  minHeight?: number | string;
  right?: React.ReactNode;
  zIndexBase?: number;
  draggable?: boolean;
  style?: React.CSSProperties;
};

export function Modal(props: ModalProps) {
  const { open, onOpenChange, title, description, right, children, footer, maxWidth = 600, minHeight, zIndexBase, draggable, style } = props;
  const baseZ = typeof zIndexBase === 'number' ? zIndexBase : 1000;
  const { t } = useTranslation();
  const tr = (key: string, fallback: string) => {
    const v = t(key);
    return v && v !== key ? v : fallback;
  };
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
        <DialogOverlay className="sys-modal__overlay" style={{ zIndex: baseZ }} />
        <DialogContent
          ref={contentRef as any}
          className="sys-modal"
          style={{
            top: pos ? pos.y : '50%',
            left: pos ? pos.x : '50%',
            transform: pos ? 'translate(0, 0) translateZ(0)' : 'translate(-50%, -50%) translateZ(0)',
            width: `min(96vw, ${typeof maxWidth === 'number' ? maxWidth + 'px' : maxWidth})`,
            minHeight: minHeight != null ? (typeof minHeight === 'number' ? `min(90vh, ${minHeight}px)` : minHeight) : undefined,
            zIndex: baseZ + 1,
            ...style
          }}
        >
          {(title || description || right !== undefined) && (
            <div onMouseDown={beginDrag} className={`sys-modal__header${draggable ? ' sys-modal__header--draggable' : ''}`}>
              <div>
                {title && <DialogTitle className="sys-modal__title">{title}</DialogTitle>}
                {description && <DialogDescription className="sys-modal__desc">{description}</DialogDescription>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {right}
                <DialogClose asChild>
                  <button className="sys-modal__close" title={tr('modal.close', 'Schließen')}>×</button>
                </DialogClose>
              </div>
            </div>
          )}
          <div className="sys-modal__body">
            {children}
          </div>
          {footer && (
            <div className="sys-modal__footer">
              {footer}
            </div>
          )}
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
