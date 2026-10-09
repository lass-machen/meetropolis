import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Button } from './Button';

export type ConfirmDialogProps = {
  open: boolean;
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (default) or as a plain action. */
  destructive?: boolean;
  onConfirm: () => void;
  /** Called for the cancel button, Escape, the close button and a click outside. */
  onCancel: () => void;
};

/**
 * In-app replacement for `window.confirm`.
 *
 * The native dialog is not usable in the desktop shell: its WebView either has
 * none or replaces `confirm` with an async stub, so `!confirm(...)` is never
 * true there and the guarded action runs without asking. This renders on the
 * same Modal as every other overlay and works the same in every shell.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, message, title, confirmLabel, cancelLabel, destructive = true, onConfirm, onCancel } = props;
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={title ?? t('confirmDialog.title')}
      maxWidth={420}
      // Confirmations open on top of other modals (sessions, tenant settings).
      zIndexBase={1100}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel ?? t('confirmDialog.cancel')}
          </Button>
          <Button variant={destructive ? 'danger' : 'brand'} onClick={onConfirm}>
            {confirmLabel ?? t('confirmDialog.confirm')}
          </Button>
        </div>
      }
    >
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{message}</p>
    </Modal>
  );
}

type ConfirmOptions = Omit<ConfirmDialogProps, 'open' | 'onConfirm' | 'onCancel'>;
type Pending = { options: ConfirmOptions; resolve: (ok: boolean) => void };

/**
 * Promise-based wrapper around {@link ConfirmDialog}, shaped like the
 * `confirm()` calls it replaces: `if (!(await confirm(message))) return;`.
 * Render the returned `dialog` once next to the component that asks.
 *
 * Resolves `false` for every way of not confirming, including a newer request
 * replacing a pending one and the owner unmounting, so an awaiting caller can
 * never be left hanging.
 */
export function useConfirmDialog() {
  const [pending, setPending] = React.useState<Pending | null>(null);
  const pendingRef = React.useRef<Pending | null>(null);

  const settle = React.useCallback((ok: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(ok);
  }, []);

  const confirm = React.useCallback((input: string | ConfirmOptions): Promise<boolean> => {
    pendingRef.current?.resolve(false);
    const options: ConfirmOptions = typeof input === 'string' ? { message: input } : input;
    return new Promise<boolean>((resolve) => {
      const next = { options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  React.useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    },
    [],
  );

  const dialog = pending ? (
    <ConfirmDialog {...pending.options} open onConfirm={() => settle(true)} onCancel={() => settle(false)} />
  ) : null;

  return { confirm, dialog };
}
