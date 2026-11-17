import { useTranslation } from 'react-i18next';
import { Toast } from '../../../ui/system/Toast';

export type CaptureErrorToastProps = {
  errorKey: string | null;
  onDismiss: () => void;
};

export function CaptureErrorToast({ errorKey, onDismiss }: CaptureErrorToastProps) {
  const { t } = useTranslation();
  if (!errorKey) return null;
  return (
    <div role="alert">
      <Toast
        open={true}
        onOpenChange={(open) => {
          if (!open) onDismiss();
        }}
        title={t('av.captureFailedTitle')}
        description={t(errorKey)}
        intent="error"
      />
    </div>
  );
}
