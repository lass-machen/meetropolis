import { useTranslation } from 'react-i18next';

export type ToastProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  intent?: 'info' | 'success' | 'error';
  style?: React.CSSProperties;
};

export function Toast(props: ToastProps) {
  const { open, onOpenChange, title, description, intent = 'info', style } = props;
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="sys-toast-container" style={style}>
      <div className={`sys-toast sys-toast--${intent}`}>
        {title && <div className="sys-toast__title">{title}</div>}
        {description && <div className="sys-toast__desc">{description}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="sys-toast__close" onClick={() => onOpenChange(false)}>
            {t('toast.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
