import * as React from 'react';
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../primitives/Dialog';
import { VisuallyHidden } from '../primitives/VisuallyHidden';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';

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

function useDraggableModal(open: boolean, draggable?: boolean) {
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
    const onUp = () => {
      setDragging(false);
    };
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

  return { contentRef, pos, beginDrag };
}

function ModalHeader({
  title,
  description,
  accessories,
  resolvedActions,
  closable,
  closeButton,
  draggable,
  beginDrag,
}: {
  title: string | React.ReactNode | undefined;
  description: string | undefined;
  accessories: React.ReactNode | undefined;
  resolvedActions: React.ReactNode | undefined;
  closable: boolean;
  closeButton: React.ReactNode;
  draggable: boolean | undefined;
  beginDrag: (e: React.MouseEvent) => void;
}) {
  const isStringTitle = typeof title === 'string';
  return (
    <div
      role="button"
      tabIndex={draggable ? 0 : -1}
      aria-label="Modal verschieben"
      onMouseDown={beginDrag}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
      }}
      className={`sys-modal__header${draggable ? ' sys-modal__header--draggable' : ''}`}
    >
      <div className="sys-modal__header-row">
        <div>
          {title &&
            (isStringTitle ? (
              <DialogTitle className="sys-modal__title">{title}</DialogTitle>
            ) : (
              <>
                <VisuallyHidden>
                  <DialogTitle>Modal</DialogTitle>
                </VisuallyHidden>
                {title}
              </>
            ))}
          {!title && (
            <VisuallyHidden>
              <DialogTitle>Modal</DialogTitle>
            </VisuallyHidden>
          )}
        </div>
        <div className="sys-modal__header-actions">
          {resolvedActions}
          {closable && closeButton}
        </div>
      </div>
      {description && <DialogDescription className="sys-modal__desc">{description}</DialogDescription>}
      {accessories && <div className="sys-modal__header-accessories">{accessories}</div>}
    </div>
  );
}

function CloseOnlyHeader({
  closeButton,
  draggable,
  beginDrag,
}: {
  closeButton: React.ReactNode;
  draggable: boolean | undefined;
  beginDrag: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={draggable ? 0 : -1}
      aria-label="Modal verschieben"
      onMouseDown={beginDrag}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
      }}
      className={`sys-modal__header${draggable ? ' sys-modal__header--draggable' : ''}`}
    >
      <VisuallyHidden>
        <DialogTitle>Modal</DialogTitle>
      </VisuallyHidden>
      <div className="sys-modal__header-row">
        <div />
        <div className="sys-modal__header-actions">{closeButton}</div>
      </div>
    </div>
  );
}

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

  const resolvedActions = actions ?? right;
  const { contentRef, pos, beginDrag } = useDraggableModal(open, draggable);

  const hasHeader = !!(title || description || resolvedActions || accessories);

  const closeButton = (
    <Button
      iconOnly
      size="sm"
      variant="ghost"
      onClick={() => onOpenChange(false)}
      title={tr('modal.close', 'Schließen')}
      aria-label={tr('modal.close', 'Schließen')}
    >
      ×
    </Button>
  );

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="sys-modal__overlay" style={{ zIndex: baseZ }} />
        <DialogContent
          ref={contentRef}
          className="sys-modal"
          style={{
            top: pos ? pos.y : '50%',
            left: pos ? pos.x : '50%',
            transform: pos ? 'translate(0, 0) translateZ(0)' : 'translate(-50%, -50%) translateZ(0)',
            width: `min(96vw, ${typeof maxWidth === 'number' ? maxWidth + 'px' : maxWidth})`,
            minHeight:
              minHeight != null ? (typeof minHeight === 'number' ? `min(90vh, ${minHeight}px)` : minHeight) : undefined,
            zIndex: baseZ + 1,
            ...style,
          }}
        >
          {hasHeader && (
            <ModalHeader
              title={title}
              description={description}
              accessories={accessories}
              resolvedActions={resolvedActions}
              closable={closable}
              closeButton={closeButton}
              draggable={draggable}
              beginDrag={beginDrag}
            />
          )}
          {!hasHeader && closable && (
            <CloseOnlyHeader closeButton={closeButton} draggable={draggable} beginDrag={beginDrag} />
          )}
          {!hasHeader && !closable && (
            <VisuallyHidden>
              <DialogTitle>Modal</DialogTitle>
            </VisuallyHidden>
          )}
          <div className="sys-modal__body">{children}</div>
          {footer && <div className="sys-modal__footer">{footer}</div>}
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
