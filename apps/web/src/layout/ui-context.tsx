import { createContext, useContext, useState, type ReactNode } from 'react';
import { UploadDocumentModal } from '../features/documents/UploadDocumentModal';
import type { Tx } from '../features/finance/fin-lib';
import { TransactionFormModal, type TxDefaults, type TxMode } from '../features/finance/TransactionForm';
import { EventFormModal } from '../features/life/EventForm';
import { PersonFormModal } from '../features/life/PeoplePage';
import { QuickCaptureModal, TaskFormModal, type TaskDefaults } from '../features/life/TaskForm';
import { WorkspaceFormModal } from '../features/workspaces/WorkspaceFormModal';
import { ProjectFormModal } from '../features/business/ProjectsPage';
import type { Workspace } from '../lib/types';
import { CommandPalette } from './CommandPalette';
import { QuickAddSheet } from './QuickAddSheet';

interface AttachTarget {
  type: string;
  id: string;
  workspaceId?: string | null;
}

interface UiCtx {
  openQuickAdd(): void;
  openSearch(): void;
  openUpload(attachTo?: AttachTarget): void;
  openWorkspaceForm(ws?: Workspace): void;
  openTransaction(mode?: TxMode, editing?: Tx | null, defaults?: TxDefaults): void;
  openTask(opts?: { id?: string; defaults?: TaskDefaults }): void;
  openQuickCapture(): void;
  openEvent(opts?: { id?: string; date?: string }): void;
  openPerson(): void;
  openProject(): void;
}

const Ctx = createContext<UiCtx | null>(null);

/** Global modals that can be opened from anywhere (quick actions, search, upload…). */
export function UiProvider({ children }: { children: ReactNode }) {
  const [quick, setQuick] = useState(false);
  const [search, setSearch] = useState(false);
  const [upload, setUpload] = useState<{ open: boolean; attachTo?: AttachTarget }>({ open: false });
  const [wsForm, setWsForm] = useState<{ open: boolean; ws?: Workspace }>({ open: false });
  const [txForm, setTxForm] = useState<{ open: boolean; mode: TxMode; editing?: Tx | null; defaults?: TxDefaults }>({
    open: false,
    mode: 'expense',
  });
  const [task, setTask] = useState<{ open: boolean; id?: string; defaults?: TaskDefaults }>({ open: false });
  const [capture, setCapture] = useState(false);
  const [event, setEvent] = useState<{ open: boolean; id?: string; date?: string }>({ open: false });
  const [person, setPerson] = useState(false);
  const [project, setProject] = useState(false);

  const value: UiCtx = {
    openQuickAdd: () => setQuick(true),
    openSearch: () => setSearch(true),
    openUpload: (attachTo) => setUpload({ open: true, attachTo }),
    openWorkspaceForm: (ws) => setWsForm({ open: true, ws }),
    openTransaction: (mode = 'expense', editing = null, defaults) => setTxForm({ open: true, mode, editing, defaults }),
    openTask: (opts = {}) => setTask({ open: true, id: opts.id, defaults: opts.defaults }),
    openQuickCapture: () => setCapture(true),
    openEvent: (opts = {}) => setEvent({ open: true, id: opts.id, date: opts.date }),
    openPerson: () => setPerson(true),
    openProject: () => setProject(true),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <QuickAddSheet open={quick} onOpenChange={setQuick} />
      <CommandPalette open={search} onOpenChange={setSearch} />
      <UploadDocumentModal open={upload.open} attachTo={upload.attachTo} onOpenChange={(o) => setUpload((s) => ({ ...s, open: o }))} />
      <WorkspaceFormModal open={wsForm.open} workspace={wsForm.ws} onOpenChange={(o) => setWsForm((s) => ({ ...s, open: o }))} />
      <TransactionFormModal
        open={txForm.open}
        initialMode={txForm.mode}
        editing={txForm.editing}
        defaults={txForm.defaults}
        onOpenChange={(o) => setTxForm((s) => ({ ...s, open: o }))}
      />
      <TaskFormModal open={task.open} taskId={task.id} defaults={task.defaults} onOpenChange={(o) => setTask((s) => ({ ...s, open: o }))} />
      <QuickCaptureModal open={capture} onOpenChange={setCapture} onMore={() => setTask({ open: true })} />
      <EventFormModal open={event.open} eventId={event.id} defaultDate={event.date} onOpenChange={(o) => setEvent((s) => ({ ...s, open: o }))} />
      <PersonFormModal open={person} onOpenChange={setPerson} />
      <ProjectFormModal open={project} onOpenChange={setProject} />
    </Ctx.Provider>
  );
}

export function useUI() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUI outside UiProvider');
  return v;
}
