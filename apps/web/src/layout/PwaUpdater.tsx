import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToast } from '../components/ui/feedback';
import { useI18n } from '../i18n';

/** Registers the service worker and offers a reload when a new version is deployed. */
export function PwaUpdater() {
  const { t } = useI18n();
  const toast = useToast();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });

  useEffect(() => {
    if (needRefresh) toast.info(t('app.updateReady'), { label: t('app.reload'), onClick: () => void updateServiceWorker(true) });
  }, [needRefresh]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
