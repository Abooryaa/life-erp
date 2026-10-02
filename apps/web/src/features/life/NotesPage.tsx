import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Archive, ArchiveRestore, ArrowLeft, Eye, NotebookPen, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Markdown } from '../../components/Markdown';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/dialog';
import { EmptyState, ErrorBlock, LoadingBlock, Spinner, useToast } from '../../components/ui/feedback';
import { Input, Textarea } from '../../components/ui/form';
import { PageHeader, Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useDebounced, useMediaQuery } from '../../lib/hooks';
import { postOrQueue } from '../../lib/outbox';
import { useWorkspace } from '../../lib/workspace';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { LinksPanel } from '../shared/LinksPanel';
import { EntityTags, TagList } from '../shared/TagEditor';

interface NoteListItem {
  id: string;
  title: string;
  excerpt: string;
  pinned: boolean;
  updatedAt: string;
  workspaceId: string | null;
  tags: string[];
}

interface NoteFull {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  archivedAt: string | null;
  workspaceId: string | null;
  updatedAt: string;
  tags: string[];
  backlinks: { id: string; title: string }[];
  links: { title: string; id: string | null }[];
}

/** Create a note and open it (used by quick add too). Works offline through the outbox. */
export function useCreateNote() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const { currentId } = useWorkspace();
  return async (title?: string) => {
    try {
      const r = await postOrQueue<{ id: string }>('/api/notes', { title: title || t('notes.untitled'), body: '', workspaceId: currentId }, title || t('notes.untitled'));
      if (r.queued) {
        toast.info(t('outbox.queued'));
        return;
      }
      await qc.invalidateQueries({ queryKey: ['notes'] });
      navigate(`/notes/${r.data.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
}

function NoteList({ activeId, archived }: { activeId?: string; archived: boolean }) {
  const { t, fmt } = useI18n();
  const { currentId } = useWorkspace();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 200);
  const { data = [], isLoading } = useQuery({
    queryKey: ['notes', 'list', dq, currentId, archived],
    queryFn: () => api.get<NoteListItem[]>(`/api/notes${qs({ q: dq, workspaceId: currentId, archived: archived ? '1' : '' })}`),
  });
  return (
    <div className="flex min-h-0 flex-col">
      <div className="p-3">
        <Input placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('common.search')} />
      </div>
      {isLoading ? (
        <div className="p-4">
          <Spinner />
        </div>
      ) : data.length === 0 ? (
        <p className="p-4 text-[13px] text-ink-3">{t('common.noResults')}</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto scrollbar-thin">
          {data.map((n) => (
            <li key={n.id}>
              <Link to={`/notes/${n.id}`} className={clsx('block px-4 py-2.5 hover:bg-surface-2', activeId === n.id && 'bg-accent-soft')}>
                <p className="flex items-center gap-1.5 truncate font-medium">
                  {n.pinned && <Pin className="size-3 shrink-0 text-accent" />}
                  <span className="truncate">{n.title}</span>
                </p>
                <p className="line-clamp-2 text-[12.5px] text-ink-3">{n.excerpt.replace(/[#*_>`[\]]/g, '')}</p>
                <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-3">
                  {fmt.relative(n.updatedAt)}
                  <TagList tags={n.tags} />
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NotesPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [archived, setArchived] = useState(false);
  const create = useCreateNote();
  const showList = isDesktop || !id;
  return (
    <div>
      {(!id || isDesktop) && (
        <PageHeader
          title={archived ? t('notes.archived') : t('notes.title')}
          actions={
            <>
              <Button variant="ghost" onClick={() => setArchived((a) => !a)}>
                {archived ? t('notes.title') : t('notes.archived')}
              </Button>
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => void create()}>
                {t('notes.new')}
              </Button>
            </>
          }
        />
      )}
      <div className={clsx('grid gap-5', isDesktop && 'grid-cols-[320px_minmax(0,1fr)]')}>
        {showList && (
          <div className="flex max-h-[calc(100dvh-170px)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <NoteList activeId={id} archived={archived} />
          </div>
        )}
        {id ? (
          <NoteEditor key={id} id={id} />
        ) : (
          isDesktop && (
            <div className="rounded-card border border-line bg-surface">
              <EmptyState icon={<NotebookPen className="size-5" />} title={t('notes.empty')} body={t('notes.emptyBody')} action={<Button variant="primary" onClick={() => void create()}>{t('notes.new')}</Button>} />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function NoteEditor({ id }: { id: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateNote();
  const { data: note, isLoading, error, refetch } = useQuery({ queryKey: ['notes', id], queryFn: () => api.get<NoteFull>(`/api/notes/${id}`) });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mode, setMode] = useState<'write' | 'preview'>('preview');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [del, setDel] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (note && !loaded.current) {
      loaded.current = true;
      setTitle(note.title);
      setBody(note.body);
      setMode(note.body ? 'preview' : 'write');
    }
  }, [note]);

  // Auto-save shortly after typing stops.
  const dTitle = useDebounced(title, 700);
  const dBody = useDebounced(body, 700);
  useEffect(() => {
    if (!loaded.current || !note) return;
    if (dTitle === note.title && dBody === note.body) return;
    if (!dTitle.trim()) return;
    setState('saving');
    api
      .put<NoteFull>(`/api/notes/${id}`, { title: dTitle, body: dBody })
      .then((n) => {
        qc.setQueryData(['notes', id], n);
        void qc.invalidateQueries({ queryKey: ['notes', 'list'] });
        setState('saved');
      })
      .catch((err) => {
        setState('idle');
        toast.error((err as Error).message);
      });
  }, [dTitle, dBody]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (p: Record<string, unknown>) => {
    try {
      const n = await api.put<NoteFull>(`/api/notes/${id}`, p);
      qc.setQueryData(['notes', id], n);
      await qc.invalidateQueries({ queryKey: ['notes', 'list'] });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const onWiki = (wikiTitle: string) => {
    const target = note?.links.find((l) => l.title.toLowerCase() === wikiTitle.toLowerCase());
    if (target?.id) navigate(`/notes/${target.id}`);
    else void create(wikiTitle);
  };

  if (isLoading) return <LoadingBlock />;
  if (error || !note) return <ErrorBlock error={error ?? 'Not found'} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <Link to="/notes" className="lg:hidden">
            <Button variant="ghost" size="icon-sm" aria-label={t('common.back')}>
              <ArrowLeft className="size-4 rtl:rotate-180" />
            </Button>
          </Link>
          <div className="inline-flex rounded-lg bg-surface-2 p-0.5">
            <Button size="sm" variant={mode === 'write' ? 'secondary' : 'ghost'} icon={<Pencil className="size-3.5" />} onClick={() => setMode('write')}>
              {t('notes.write')}
            </Button>
            <Button size="sm" variant={mode === 'preview' ? 'secondary' : 'ghost'} icon={<Eye className="size-3.5" />} onClick={() => setMode('preview')}>
              {t('notes.preview')}
            </Button>
          </div>
          <span className="ms-auto text-[12px] text-ink-3">{state === 'saving' ? t('notes.saving') : state === 'saved' ? t('notes.saved') : ''}</span>
          <Button size="icon-sm" variant="ghost" onClick={() => patch({ pinned: !note.pinned })} aria-label={note.pinned ? t('notes.unpin') : t('notes.pin')} title={note.pinned ? t('notes.unpin') : t('notes.pin')}>
            {note.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => patch({ archived: !note.archivedAt })} aria-label={t('notes.archive')} title={t('notes.archive')}>
            {note.archivedAt ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setDel(true)} aria-label={t('common.delete')}>
            <Trash2 className="size-4 text-neg" />
          </Button>
        </div>
        <div className="p-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mb-3 w-full bg-transparent text-[22px] font-semibold outline-none placeholder:text-ink-3"
            placeholder={t('notes.untitled')}
            aria-label={t('common.name')}
          />
          {mode === 'write' ? (
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={18} placeholder={t('notes.placeholder')} className="font-[inherit] text-[14.5px]" autoFocus={!body} />
          ) : body ? (
            <div onDoubleClick={() => setMode('write')}>
              <Markdown source={body} onWikiLink={onWiki} />
            </div>
          ) : (
            <button onClick={() => setMode('write')} className="text-ink-3">
              {t('notes.placeholder')}
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Panel title={t('common.tags')}>
          <EntityTags type="note" id={note.id} tags={note.tags} invalidate={[['notes']]} />
        </Panel>
        <Panel title={t('notes.backlinks')} padded={false}>
          {note.backlinks.length === 0 ? (
            <p className="p-4 text-[13px] text-ink-3">—</p>
          ) : (
            <ul className="divide-y divide-line">
              {note.backlinks.map((b) => (
                <li key={b.id}>
                  <Link to={`/notes/${b.id}`} className="block px-4 py-2 hover:bg-surface-2">
                    {b.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <AttachmentsPanel type="note" id={note.id} workspaceId={note.workspaceId} />
        <LinksPanel type="note" id={note.id} />
      </div>
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={t('common.deleteConfirm', { name: note.title })}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          await api.del(`/api/notes/${id}`);
          await qc.invalidateQueries({ queryKey: ['notes'] });
          navigate('/notes');
        }}
      />
    </div>
  );
}
