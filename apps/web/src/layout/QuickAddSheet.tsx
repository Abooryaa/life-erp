import { Building2, FileUp, type LucideIcon } from 'lucide-react';
import { Modal } from '../components/ui/dialog';
import { useI18n, type MessageKey } from '../i18n';
import { useUI } from './ui-context';

interface QuickAction {
  key: string;
  label: MessageKey;
  icon: LucideIcon;
  tone: string;
  run: (ui: ReturnType<typeof useUI>) => void;
}

/**
 * Fast actions. Each phase adds its own (Expense, Income, Task, Note, Event…).
 * Only actions that are fully working are listed.
 */
export const QUICK_ACTIONS: QuickAction[] = [
  { key: 'document', label: 'quick.document', icon: FileUp, tone: 'bg-info-soft text-info', run: (ui) => ui.openUpload() },
  { key: 'workspace', label: 'quick.workspace', icon: Building2, tone: 'bg-surface-2 text-ink-2', run: (ui) => ui.openWorkspaceForm() },
];

export function QuickAddSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const ui = useUI();
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
                a.run(ui);
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
