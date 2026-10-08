import { createContext, useContext, type ReactNode } from 'react';
import { purchaseAreaKey } from './project-area-routing';
export { projectAreaPath, purchaseAreaKey, withPurchaseArea, withPurchaseAreaQueryKey } from './project-area-routing';

const lastAreaStorageKey = (projectId: string) => `sogo:last-purchase-area:${projectId}`;

export function getLastPurchaseAreaId(projectId: string) {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(lastAreaStorageKey(projectId));
    return value && value !== 'general' ? value : null;
  } catch {
    return null;
  }
}

export function rememberPurchaseArea(projectId: string, purchaseAreaId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(lastAreaStorageKey(projectId), purchaseAreaId ?? 'general');
  } catch {
    // The route itself still preserves the selected topic when storage is unavailable.
  }
}

export type ProjectAreaContextValue = {
  projectId: string;
  purchaseAreaId: string | null;
  areaKey: string;
};

const ProjectAreaContext = createContext<ProjectAreaContextValue>({
  projectId: '',
  purchaseAreaId: null,
  areaKey: 'general',
});

export function ProjectAreaProvider({
  projectId,
  purchaseAreaId,
  children,
}: {
  projectId: string;
  purchaseAreaId: string | null;
  children: ReactNode;
}) {
  return (
    <ProjectAreaContext.Provider
      value={{
        projectId,
        purchaseAreaId,
        areaKey: purchaseAreaKey(purchaseAreaId),
      }}
    >
      {children}
    </ProjectAreaContext.Provider>
  );
}

export function useProjectArea() {
  return useContext(ProjectAreaContext);
}

export function registerPurchaseAreaDirtyGuard(
  key: string,
  isDirty: () => boolean,
) {
  areaDirtyGuards.set(key, isDirty);
  return () => {
    if (areaDirtyGuards.get(key) === isDirty) areaDirtyGuards.delete(key);
  };
}

const areaDirtyGuards = new Map<string, () => boolean>();

export function confirmPurchaseAreaSwitch(
  message = 'Masz niezapisane zmiany. Czy na pewno chcesz przełączyć obszar zakupowy?',
) {
  const hasDirtyDraft = Array.from(areaDirtyGuards.values()).some((isDirty) => {
    try {
      return isDirty();
    } catch {
      return false;
    }
  });
  if (!hasDirtyDraft || typeof window === 'undefined') return true;
  return window.confirm(message);
}