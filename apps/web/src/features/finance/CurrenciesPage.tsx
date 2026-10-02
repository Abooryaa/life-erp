import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Badge, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, TextField } from '../../components/ui/form';
import { PageHeader, Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { FIN_KEYS, todayIso, useCurrencies } from './fin-lib';

interface Rate {
  id: string;
  currency: string;
  base: string;
  rate: number;
  date: string;
}

export function CurrenciesPage() {
  const { t, fmt, locale } = useI18n();
  const { data: currencies = [] } = useCurrencies();
  const rates = useQuery({ queryKey: ['finance', 'rates'], queryFn: () => api.get<{ base: string; items: Rate[] }>('/api/finance/rates') });
  const rateForm = useFormState({ currency: 'USD', rate: '', date: todayIso() });
  const curForm = useFormState({ code: '', name: '', digits: '2' });
  const [showAdd, setShowAdd] = useState(false);
  const addRate = useAction(() => api.post('/api/finance/rates', rateForm.values), {
    invalidate: FIN_KEYS,
    success: t('common.saved'),
    silentFieldErrors: true,
    onSuccess: () => rateForm.set('rate', ''),
  });
  const delRate = useAction((id: string) => api.del(`/api/finance/rates/${id}`), { invalidate: FIN_KEYS });
  const addCur = useAction(() => api.post('/api/finance/currencies', { ...curForm.values, digits: Number(curForm.values.digits) }), {
    invalidate: [['finance']],
    success: t('common.saved'),
    silentFieldErrors: true,
    onSuccess: () => {
      curForm.reset();
      setShowAdd(false);
    },
  });
  if (rates.isLoading || !rates.data) return <LoadingBlock />;
  const base = rates.data.base;
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title={t('cur.title')} subtitle={t('cur.base', { currency: base })} />
      <Panel title={t('cur.rates')}>
        <form
          className="mb-4 grid grid-cols-2 items-end gap-2 md:grid-cols-[1fr_1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            addRate.mutate(undefined, { onError: rateForm.fail });
          }}
        >
          <Field label={t('common.currency')}>
            <Select value={rateForm.values.currency} onChange={(e) => rateForm.set('currency', e.target.value)}>
              {currencies
                .filter((c) => c.code !== base)
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('cur.rateHint', { currency: rateForm.values.currency, base })} error={rateForm.errors.rate}>
            <Input inputMode="decimal" dir="ltr" value={rateForm.values.rate} onChange={(e) => rateForm.set('rate', e.target.value)} />
          </Field>
          <Field label={t('common.date')}>
            <Input type="date" value={rateForm.values.date} onChange={(e) => rateForm.set('date', e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" loading={addRate.isPending}>
            {t('common.add')}
          </Button>
        </form>
        <FormError message={rateForm.formError} />
        {rates.data.items.length === 0 ? (
          <p className="text-[13.5px] text-ink-3">{t('cur.noRates')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {rates.data.items.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <span className="num w-24 text-[13px] text-ink-3">{fmt.date(r.date)}</span>
                <span className="flex-1" dir="ltr">
                  1 {r.currency} = <span className="num font-semibold">{fmt.number(r.rate)}</span> {r.base}
                </span>
                <Button size="icon-sm" variant="ghost" onClick={() => delRate.mutate(r.id)} aria-label={t('common.delete')}>
                  <Trash2 className="size-4 text-neg" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel
        title={t('nav.currencies')}
        padded={false}
        actions={
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setShowAdd((s) => !s)}>
            {t('cur.add')}
          </Button>
        }
      >
        {showAdd && (
          <form
            className="grid grid-cols-2 items-end gap-2 border-b border-line p-4 md:grid-cols-[100px_1fr_100px_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              addCur.mutate(undefined, { onError: curForm.fail });
            }}
          >
            <TextField label={t('cur.code')} dir="ltr" maxLength={3} value={curForm.values.code} onChange={(e) => curForm.set('code', e.target.value.toUpperCase())} error={curForm.errors.code} />
            <TextField label={t('common.name')} value={curForm.values.name} onChange={(e) => curForm.set('name', e.target.value)} error={curForm.errors.name} />
            <Field label={t('cur.digits')}>
              <Select value={curForm.values.digits} onChange={(e) => curForm.set('digits', e.target.value)}>
                {[0, 1, 2, 3].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="primary" loading={addCur.isPending}>
              {t('common.add')}
            </Button>
            <div className="col-span-full">
              <FormError message={curForm.formError} />
            </div>
          </form>
        )}
        <ul className="divide-y divide-line">
          {currencies.map((c) => (
            <li key={c.code} className="flex items-center gap-3 px-4 py-2">
              <span className="w-12 font-semibold" dir="ltr">
                {c.code}
              </span>
              <span className="flex-1 text-ink-2">{locale === 'ar' ? c.nameAr : c.name}</span>
              {c.code === base && <Badge tone="accent">{base}</Badge>}
              {c.custom && <Badge>{t('cur.custom')}</Badge>}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
