import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Building2, CalendarPlus, CheckSquare, FileUp, FolderKanban, NotebookPen, UserPlus, type LucideIcon } from 'lucide-react';
import { useCreateNote } from '../features/life/NotesPage';
import { Modal } from '../components/ui/dialog';
import { useI18n, type MessageKey } from '../i18n';
import { useUI } from './ui-context';

interface QuickAction {
  key: string;
  label: MessageKey;
  icon: LucideIcon;
  tone: string;
  run: (ui: ReturnType<typeof useUI>, helpers: { createNote: () => void }) => void;
}

/** Fast actions — every one opens a working form. */
export const QUICK_ACTIONS: QuickAction[] = [
  { key: 'expense', label: 'quick.expense', icon: ArrowUpRight, tone: 'bg-neg-soft text-neg', run: (ui) => ui.openTransaction('expense') },
  { key: 'income', label: 'quick.income', icon: ArrowDownLeft, tone: 'bg-pos-soft text-pos', run: (ui) => ui.openTransaction('income') },
  { key: 'task', label: 'quick.task', icon: CheckSquare, tone: 'bg-accent-soft text-accent', run: (ui) => ui.openQuickCapture() },
  { key: 'transfer', label: 'quick.transfer', icon: ArrowLeftRight, tone: 'bg-info-soft text-info', run: (ui) => ui.openTransaction('transfer') },
  { key: 'event', label: 'quick.event', icon: CalendarPlus, tone: 'bg-warn-soft text-warn', run: (ui) => ui.openEvent() },
  { key: 'note', label: 'quick.note', icon: NotebookPen, tone: 'bg-surface-2 text-ink-2', run: (_ui, h) => h.createNote() },
  { key: 'project', label: 'quick.project', icon: FolderKanban, tone: 'bg-pos-soft text-pos', run: (ui) => ui.openProject() },
  { key: 'contact', label: 'quick.contact', icon: UserPlus, tone: 'bg-surface-2 text-ink-2', run: (ui) => ui.openPerson() },
  { key: 'document', label: 'quick.document', icon: FileUp, tone: 'bg-surface-2 text-ink-2', run: (ui) => ui.openUpload() },
  { key: 'workspace', label: 'quick.workspace', icon: Building2, tone: 'bg-surface-2 text-ink-2', run: (ui) => ui.openWorkspaceForm() },
];

export function QuickAddSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const ui = useUI();
  const createNote = useCreateNote();
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t('quick.title')} size="sm">
      <div className="grid grid-cols-3 gap-2 pb-2">
        {QUICK_ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.key}
              onClick={() => {
                onOpenChange(false);
                a.run(ui, { createNote: () => void createNote() });
              }}
              className="flex flex-col items-center gap-2 rounded-xl border border-line px-2 py-4 hover:bg-surface-2"
            >
              <span className={`flex size-11 items-center justify-center rounded-full ${a.tone}`}>
                <Icon className="size-5" />
              </span>
              <span className="text-[13px] font-medium">{t(a.label)}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
