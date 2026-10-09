import { useQuery } from '@tanstack/react-query';
import { Files, FolderKanban, FileCheck2 } from 'lucide-react';
import { listProjectDocuments, type Project } from '@/lib/api';

export function ProjectStatistics({ projects, userId, ready, failed }: {
  projects: Project[]; userId?: string | null; ready: boolean; failed: boolean;
}) {
  const projectIds = [...new Set(projects.map(project => project.projectId))].sort();
  const statistics = useQuery({
    queryKey: ['project-statistics', userId, projectIds],
    enabled: ready && Boolean(userId),
    queryFn: async ({ signal }) => {
      let next = 0;
      const documents = new Map<string, { documentType?: string | null }>();
      // Bound concurrency. Read metadata only, once per project library, not per topic.
      const read = async () => {
        while (next < projectIds.length) {
          const projectId = projectIds[next++];
          const files = await listProjectDocuments(projectId, signal);
          for (const file of files) {
            if (file.status === 'UPLOADED') documents.set(`${projectId}/${file.documentId}`, file);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, projectIds.length) }, read));
      return { documents: documents.size, offers: [...documents.values()].filter(file => file.documentType === 'OFFER').length };
    },
    retry: false,
    staleTime: 60_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const format = (value: number) => value.toLocaleString('pl-PL');
  const pending = !ready || statistics.isPending;
  const unavailable = failed || statistics.isError;
  const count = (key: 'documents' | 'offers') => unavailable ? '—' : pending ? '…' : format(statistics.data?.[key] ?? 0);
  const metrics = [
    { label: 'Projekty', value: failed ? '—' : ready ? format(projectIds.length) : '…', detail: 'Dostępne dla Ciebie', Icon: FolderKanban },
    { label: 'Dokumenty', value: count('documents'), detail: 'W bibliotekach projektów', Icon: Files },
    { label: 'Oferty', value: count('offers'), detail: 'Wśród tych dokumentów', Icon: FileCheck2 },
  ];
  return <section className="mt-6 rounded-2xl border border-border bg-card/70" aria-label="Statystyki dostępnych projektów" data-testid="project-statistics">
    <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {metrics.map(({ label, value, detail, Icon }) => <div key={label} className="flex items-center gap-4 p-5 sm:p-6">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-secondary text-accent"><Icon size={21} aria-hidden="true" /></div>
        <div><p className="text-xs font-semibold text-muted-foreground">{label}</p>
          <p className="my-1 font-display text-3xl font-bold tracking-tight tabular-nums" data-testid={`stat-${label}`}>{value}</p>
          <p className="text-xs text-muted-foreground">{detail}</p></div>
      </div>)}
    </div>
    <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground" role="status">
      {unavailable ? 'Nie udało się wczytać wszystkich statystyk. Wróć do tej strony za chwilę.' : pending ? 'Zliczanie dokumentów…' : 'Tylko projekty, do których masz dostęp. Plik przypisany do kilku tematów liczymy raz. Faktury z osobnej sekcji nie są uwzględniane.'}
    </p>
  </section>;
}
