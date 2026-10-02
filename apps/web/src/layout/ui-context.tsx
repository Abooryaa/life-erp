import { createContext, useContext, useState, type ReactNode } from 'react';
import { UploadDocumentModal } from '../features/documents/UploadDocumentModal';
import { WorkspaceFormModal } from '../features/workspaces/WorkspaceFormModal';
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
}

const Ctx = createContext<UiCtx | null>(null);

/** Global modals that can be opened from anywhere (quick actions, search, upload…). */
export function UiProvider({ children }: { children: ReactNode }) {
  const [quick, setQuick] = useState(false);
  const [search, setSearch] = useState(false);
  const [upload, setUpload] = useState<{ open: boolean; attachTo?: AttachTarget }>({ open: false });
  const [wsForm, setWsForm] = useState<{ open: boolean; ws?: Workspace }>({ open: false });

  const value: UiCtx = {
    openQuickAdd: () => setQuick(true),
    openSearch: () => setSearch(true),
    openUpload: (attachTo) => setUpload({ open: true, attachTo }),
    openWorkspaceForm: (ws) => setWsForm({ open: true, ws }),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <QuickAddSheet open={quick} onOpenChange={setQuick} />
      <CommandPalette open={search} onOpenChange={setSearch} />
      <UploadDocumentModal open={upload.open} attachTo={upload.attachTo} onOpenChange={(o) => setUpload((s) => ({ ...s, open: o }))} />
      <WorkspaceFormModal open={wsForm.open} workspace={wsForm.ws} onOpenChange={(o) => setWsForm((s) => ({ ...s, open: o }))} />
    </Ctx.Provider>
  );
}

export function useUI() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUI outside UiProvider');
  return v;
}
