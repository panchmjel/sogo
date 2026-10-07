import { createContext, useContext, type ReactNode } from 'react';
import { purchaseAreaKey } from './project-area-routing';
export { projectAreaPath, purchaseAreaKey, withPurchaseArea, withPurchaseAreaQueryKey } from './project-area-routing';

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