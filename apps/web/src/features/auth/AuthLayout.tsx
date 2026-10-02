import { Languages } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandMark, BrandName } from '../../components/Brand';
import { useI18n, rememberLocale } from '../../i18n';

export function AuthLayout({ title, subtitle, children, wide }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  const { locale } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10 md:justify-center">
      <div className={wide ? 'w-full max-w-xl' : 'w-full max-w-sm'}>
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <BrandName className="text-[17px]" />
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-ink-2 hover:bg-surface-2"
            onClick={() => {
              rememberLocale(locale === 'ar' ? 'en' : 'ar');
              window.location.reload();
            }}
          >
            <Languages className="size-4" />
            {locale === 'ar' ? 'English' : 'العربية'}
          </button>
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-3">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
