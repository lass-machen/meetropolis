import * as React from 'react';
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription } from '../primitives/Dialog';
import { VisuallyHidden } from '../primitives/VisuallyHidden';
import { useTranslation } from 'react-i18next';

export type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  // Header
  title?: string | React.ReactNode;
  description?: string;
  actions?: React.ReactNode;
  accessories?: React.ReactNode;
  closable?: boolean;

  // Body
  children: React.ReactNode;

  // Footer
  footer?: React.ReactNode;

  // Layout
  maxWidth?: number | string;
  minHeight?: number | string;
  zIndexBase?: number;
  draggable?: boolean;
  style?: React.CSSProperties;

  // Deprecated (backward compatibility)
  /** @deprecated Use `actions` instead */
  right?: React.ReactNode;
};

export function Modal(props: ModalProps) {
  const {
    open,
    onOpenChange,
    title,
    description,
    actions,
    accessories,
    closable = true,
    children,
    footer,
    maxWidth = 600,
    minHeight,
    zIndexBase,
    draggable,
    style,
    right,
  } = props;

  const baseZ = typeof zIndexBase === 'number' ? zIndexBase : 1000;
  const { t } = useTranslation();
  const tr = (key: string, fallback: string) => {
    const v = t(key);
    return v && v !== key ? v : fallback;
  };

  // Backward compatibility: right -> actions
  const resolvedActions = actions ?? right;

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
    if (!pos) setPos({ x: rect.left, y: rect.top });
    e.preventDefault();
  };

  const hasHeader = !!(title || description || resolvedActions || accessories);
  const isStringTitle = typeof title === 'string';

  const closeButton = (
    <button
      className="sys-modal__close"
      title={tr('modal.close', 'Schließen')}
      onClick={() => onOpenChange(false)}
    >
      ×
    </button>
  );

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
            ...style,
          }}
        >
          {/* Accessibility: always render a DialogTitle for Radix */}
          {hasHeader && (
            <div
              onMouseDown={beginDrag}
              className={`sys-modal__header${draggable ? ' sys-modal__header--draggable' : ''}`}
            >
              {/* Title row: title left, actions + close right */}
              <div className="sys-modal__header-row">
                <div>
                  {title && (
                    isStringTitle
                      ? <DialogTitle className="sys-modal__title">{title}</DialogTitle>
                      : <>
                          <VisuallyHidden><DialogTitle>Modal</DialogTitle></VisuallyHidden>
                          {title}
                        </>
                  )}
                  {!title && (
                    <VisuallyHidden><DialogTitle>Modal</DialogTitle></VisuallyHidden>
                  )}
                </div>
                <div className="sys-modal__header-actions">
                  {resolvedActions}
                  {closable && closeButton}
                </div>
              </div>

              {/* Description */}
              {description && (
                <DialogDescription className="sys-modal__desc">{description}</DialogDescription>
              )}

              {/* Accessories (e.g. tabs, search field) */}
              {accessories && (
                <div className="sys-modal__header-accessories">{accessories}</div>
              )}
            </div>
          )}

          {/* No header but closable: render only close button */}
          {!hasHeader && closable && (
            <div className={`sys-modal__header${draggable ? ' sys-modal__header--draggable' : ''}`} onMouseDown={beginDrag}>
              <VisuallyHidden><DialogTitle>Modal</DialogTitle></VisuallyHidden>
              <div className="sys-modal__header-row">
                <div />
                <div className="sys-modal__header-actions">
                  {closeButton}
                </div>
              </div>
            </div>
          )}

          {/* No header and not closable: still need DialogTitle for accessibility */}
          {!hasHeader && !closable && (
            <VisuallyHidden><DialogTitle>Modal</DialogTitle></VisuallyHidden>
          )}

          {/* Body - scrollable */}
          <div className="sys-modal__body">
            {children}
          </div>

          {/* Footer - fixed at bottom, only when present */}
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
