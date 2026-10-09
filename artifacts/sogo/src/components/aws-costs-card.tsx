import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud } from 'lucide-react';
import {
  type ApiRole,
  getAdminAwsCosts,
} from '@/lib/api';
import {
  canLoadAdminAwsCosts,
  formatAiAwsUsd,
  formatAwsUsd,
  getAdminAwsCostsView,
  makeAdminAwsCostsQueryData,
  type AdminAwsCostsQueryData,
} from '@/lib/aws-costs';

const AWS_COSTS_STALE_TIME = 60 * 1000;

function useDesktopSidebar() {
  const [desktop, setDesktop] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(min-width: 64rem)').matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(min-width: 64rem)');
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return desktop;
}

function fetchedAtLabel(value: string) {
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function AwsCostsCard({
  role,
  authUserId,
  menuOpen,
}: {
  role: ApiRole;
  authUserId: string | null | undefined;
  menuOpen: boolean;
}) {
  const desktopSidebar = useDesktopSidebar();
  const queryClient = useQueryClient();
  const enabled = canLoadAdminAwsCosts(role, authUserId, menuOpen, desktopSidebar);
  const queryKey = ['admin-aws-costs', authUserId] as const;
  const query = useQuery<AdminAwsCostsQueryData>({
    queryKey,
    queryFn: async ({ signal }) => {
      const previous = queryClient.getQueryData<AdminAwsCostsQueryData>(queryKey);
      const response = await getAdminAwsCosts(signal);
      return makeAdminAwsCostsQueryData(response, previous);
    },
    enabled,
    retry: false,
    staleTime: AWS_COSTS_STALE_TIME,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const view = getAdminAwsCostsView(query.data, query.isError);
  const loading = enabled && query.isPending;
  const cost = view.cost;
  const anthropic = query.data?.anthropic;

  return (
    <section
      className="mx-5 mt-5 rounded-xl border border-sidebar-border bg-sidebar-accent/45 p-3.5"
      aria-labelledby="aws-costs-card-title"
      data-testid="card-aws-costs"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="aws-costs-card-title" className="text-xs font-bold leading-5 text-sidebar-foreground">
            Koszty — ten miesiąc
          </h2>
          {cost && <p className="mt-0.5 font-mono text-[9px] text-sidebar-foreground/45">{cost.month}</p>}
        </div>
        <Cloud size={14} className="mt-0.5 shrink-0 text-sidebar-foreground/45" aria-hidden="true" />
      </div>

      {cost ? (
        <>
          <p className="mt-3 font-display text-2xl font-bold leading-none tracking-tight text-sidebar-foreground" data-testid="text-aws-cost-total">
            <span className="mb-1 block text-xs font-normal">AWS</span>
            {formatAwsUsd(cost.totalUsd)}
          </p>
          <p className="mt-2 text-[10px] leading-4 text-sidebar-foreground/70" data-testid="text-aws-cost-ai">
            <span className="font-semibold">W tym AI:</span> {formatAiAwsUsd(cost.aiUsd)}
          </p>
          {(cost.estimated || cost.stale) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cost.estimated && <span className="rounded-full bg-sidebar-foreground/10 px-2 py-0.5 text-[9px] font-semibold text-sidebar-foreground/75">Szacunkowo</span>}
              {cost.stale && <span className="rounded-full bg-sidebar-foreground/10 px-2 py-0.5 text-[9px] font-semibold text-sidebar-foreground/75">Ostatnie dostępne dane</span>}
            </div>
          )}
          {view.unavailable && <p className="mt-2 text-[10px] font-medium text-sidebar-foreground/65" role="status">Koszty chwilowo niedostępne</p>}
          <p className="mt-2 text-[9px] leading-4 text-sidebar-foreground/45" data-testid="text-aws-cost-fetched-at">
            Pobrano {fetchedAtLabel(cost.fetchedAt)}
          </p>
        </>
      ) : loading ? (
        <p className="mt-3 text-[10px] text-sidebar-foreground/60" role="status">Wczytywanie kosztów…</p>
      ) : !enabled && !query.data && !query.isError ? (
        <p className="mt-3 text-[10px] text-sidebar-foreground/60" role="status">Otwórz menu, aby wczytać dane</p>
      ) : view.unavailable ? (
        <p className="mt-3 text-[10px] leading-4 text-sidebar-foreground/70" role="status">Koszty chwilowo niedostępne</p>
      ) : (
        <p className="mt-3 text-[10px] text-sidebar-foreground/60" role="status">Otwórz menu, aby wczytać dane</p>
      )}

      <div className="mt-3 border-t border-sidebar-border pt-3" data-testid="anthropic-costs">
        <p className="text-xs font-semibold text-sidebar-foreground">Anthropic — aplikacja</p>
        <p className="mt-1 text-xl font-bold text-sidebar-foreground">
          {anthropic && anthropic.status !== 'UNAVAILABLE' && anthropic.totalUsd !== null
            ? formatAwsUsd(anthropic.totalUsd) : 'Brak danych'}
        </p>
        <p className="mt-1 text-[10px] text-sidebar-foreground/65">
          Szacunek{anthropic ? ` od ${anthropic.trackingSince}` : ''}. Nie obejmuje wcześniejszych zapytań ani innych aplikacji.
          {anthropic?.status === 'PARTIAL' ? ' Część zapytań nie została wyceniona.' : ''}
          {query.isError ? ' Ostatnie dostępne dane.' : ''}
        </p>
      </div>
      <p className="mt-3 border-t border-sidebar-border pt-2.5 text-[9px] leading-4 text-sidebar-foreground/45">
        Całe konto AWS. Dane aktualizowane z opóźnieniem.
      </p>
    </section>
  );
}

