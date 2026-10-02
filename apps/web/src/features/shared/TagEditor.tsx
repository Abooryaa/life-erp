import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Hash, X } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../components/ui/feedback';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import type { TagItem } from '../../lib/types';

function normalise(s: string) {
  return s.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-');
}

/** Chip input for tags with suggestions from the global tag list. */
export function TagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const { data: all = [] } = useQuery({ queryKey: ['tags'], queryFn: () => api.get<TagItem[]>('/api/tags'), staleTime: 60_000 });
  const d = normalise(draft);
  const suggestions = d ? all.filter((tg) => tg.name.includes(d) && !value.includes(tg.name)).slice(0, 6) : [];

  const add = (name: string) => {
    const n = normalise(name);
    if (n && !value.includes(n)) onChange([...value, n]);
    setDraft('');
  };

  return (
    <div className="relative">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2 py-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-0.5 rounded-md bg-surface-2 py-0.5 ps-1.5 pe-0.5 text-[12.5px]">
            <Hash className="size-3 text-ink-3" />
            {tag}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== tag))} className="rounded p-0.5 text-ink-3 hover:text-ink" aria-label={`${t('common.remove')} ${tag}`}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && draft.trim()) {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={value.length ? '' : t('tags.placeholder')}
          className="min-w-24 flex-1 bg-transparent py-0.5 outline-none placeholder:text-ink-3"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="absolute inset-x-0 top-full z-10 mt-1 rounded-lg border border-line bg-surface p-1 shadow-pop">
          {suggestions.map((s) => (
            <button key={s.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s.name)} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-start text-[13px] hover:bg-surface-2">
              <Hash className="size-3 text-ink-3" />
              {s.name}
              <span className="ms-auto text-[12px] text-ink-3">{t('tags.usage', { n: s.usage })}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tag editor bound to a saved record: changes are saved immediately. */
export function EntityTags({ type, id, tags, invalidate = [] }: { type: string; id: string; tags: string[]; invalidate?: unknown[][] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { te } = useI18n();
  const [value, setValue] = useState(tags);
  return (
    <TagInput
      value={value}
      onChange={async (next) => {
        setValue(next);
        try {
          const saved = await api.put<string[]>('/api/tags/for', { entity: { type, id }, tags: next });
          setValue(saved);
          await Promise.all([qc.invalidateQueries({ queryKey: ['tags'] }), ...invalidate.map((k) => qc.invalidateQueries({ queryKey: k }))]);
        } catch (err) {
          setValue(tags);
          toast.error(te((err as Error).message));
        }
      }}
    />
  );
}

export function TagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((tg) => (
        <span key={tg} className="inline-flex items-center rounded bg-surface-2 px-1.5 text-[12px] text-ink-2">
          #{tg}
        </span>
      ))}
    </span>
  );
}
