import * as D from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { Button } from './button';
import { Input } from './form';

/**
 * Modal that is a centred dialog on desktop and a bottom sheet on phones.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const { t, dir } = useI18n();
  const width = { sm: 'md:max-w-sm', md: 'md:max-w-lg', lg: 'md:max-w-2xl', xl: 'md:max-w-4xl' }[size];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] data-[state=open]:animate-[fade_120ms_ease-out]" />
        <D.Content
          dir={dir}
          className={clsx(
            'fixed z-50 flex max-h-[92dvh] w-full flex-col bg-surface shadow-pop focus:outline-none',
            'inset-x-0 bottom-0 rounded-t-2xl safe-bottom',
            'md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:pb-0',
            width,
          )}
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-surface-3 md:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 pt-3 pb-3 md:pt-4">
            <div className="min-w-0">
              <D.Title className="text-[16px] font-semibold">{title}</D.Title>
              {description ? (
                <D.Description className="mt-0.5 text-[13px] text-ink-3">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{typeof title === 'string' ? title : ''}</D.Description>
              )}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('common.close')}>
                <X className="size-4" />
              </Button>
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Confirmation for destructive actions; optionally requires typing a word. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  danger = true,
  requireWord,
  loading,
  onConfirm,
  error,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireWord?: string;
  loading?: boolean;
  onConfirm: (typed: string) => void;
  error?: string | null;
}) {
  const { t, te } = useI18n();
  const [typed, setTyped] = useState('');
  const ok = !requireWord || typed.trim() === requireWord;
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped('');
        onOpenChange(o);
      }}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} disabled={!ok} loading={loading} onClick={() => onConfirm(typed.trim())}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-ink-2">
        {body}
        {requireWord && (
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium">{t('common.typeToConfirm', { word: requireWord })}</p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus dir="ltr" autoComplete="off" />
          </div>
        )}
        {error && <p className="text-[13px] text-neg">{te(error)}</p>}
      </div>
    </Modal>
  );
}
