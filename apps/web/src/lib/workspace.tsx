import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useWorkspaces } from './hooks';
import type { Workspace } from './types';

interface WorkspaceCtx {
  /** null = "All workspaces" */
  current: Workspace | null;
  currentId: string | null;
  setCurrentId: (id: string | null) => void;
  workspaces: Workspace[];
  byId: (id: string | null | undefined) => Workspace | undefined;
}

const Ctx = createContext<WorkspaceCtx | null>(null);
const KEY = 'lerp.workspace';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data: workspaces = [] } = useWorkspaces(true);
  const [currentId, setCurrentIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY) || null;
    } catch {
      return null;
    }
  });
  const active = workspaces.filter((w) => !w.archivedAt);

  useEffect(() => {
    // Forget a selection that no longer exists (deleted/archived workspace).
    if (currentId && workspaces.length && !active.find((w) => w.id === currentId)) setCurrentIdState(null);
  }, [currentId, workspaces]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<WorkspaceCtx>(
    () => ({
      current: active.find((w) => w.id === currentId) ?? null,
      currentId: active.find((w) => w.id === currentId) ? currentId : null,
      setCurrentId: (id) => {
        setCurrentIdState(id);
        try {
          if (id) localStorage.setItem(KEY, id);
          else localStorage.removeItem(KEY);
        } catch {
          /* ignore */
        }
      },
      workspaces: active,
      byId: (id) => (id ? workspaces.find((w) => w.id === id) : undefined),
    }),
    [currentId, workspaces], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace outside WorkspaceProvider');
  return v;
}
