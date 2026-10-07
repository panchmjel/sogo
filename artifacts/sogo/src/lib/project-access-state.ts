import type { Project } from './api';

export type ProjectAccessState = 'checking' | 'granted' | 'denied' | 'error';

export function getProjectAccessState({
  projectId,
  projects,
  isFetchedAfterMount,
  isError,
  isFetching,
}: {
  projectId: string;
  projects: readonly Project[] | undefined;
  isFetchedAfterMount: boolean;
  isError: boolean;
  isFetching: boolean;
}): ProjectAccessState {
  if (!isFetchedAfterMount || (isError && isFetching)) return 'checking';
  if (isError) return 'error';
  if (!projects) return 'checking';
  return projects.some((project) => project.projectId === projectId) ? 'granted' : 'denied';
}