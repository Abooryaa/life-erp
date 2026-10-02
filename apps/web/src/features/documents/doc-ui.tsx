import { File, FileImage, FileSpreadsheet, FileText, FileType2 } from 'lucide-react';
import { Badge } from '../../components/ui/feedback';
import { useI18n, type MessageKey } from '../../i18n';

export function DocIcon({ mime }: { mime: string }) {
  const Icon = mime.startsWith('image/')
    ? FileImage
    : mime === 'application/pdf'
      ? FileType2
      : /sheet|excel|csv/.test(mime)
        ? FileSpreadsheet
        : /word|text/.test(mime)
          ? FileText
          : File;
  const tone = mime === 'application/pdf' ? 'text-neg' : mime.startsWith('image/') ? 'text-info' : /sheet|excel|csv/.test(mime) ? 'text-pos' : 'text-ink-2';
  return (
    <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 ${tone}`}>
      <Icon className="size-[18px]" />
    </span>
  );
}

export function useDocTypeLabel() {
  const { t } = useI18n();
  return (type: string) => t(`docs.type.${type}` as MessageKey);
}

/** Days until a date (negative = past), computed in calendar days. */
export function daysUntil(date: string) {
  const today = new Date();
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [y, m, d] = date.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - t0) / 86_400_000);
}

export function ExpiryBadge({ expiresOn }: { expiresOn: string | null }) {
  const { t } = useI18n();
  if (!expiresOn) return null;
  const days = daysUntil(expiresOn);
  if (days < 0) return <Badge tone="neg">{t('docs.expired')}</Badge>;
  if (days <= 30) return <Badge tone="warn">{t('docs.expiresSoon')}</Badge>;
  return null;
}
