import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Bot,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  CircleAlert,
  CircleDashed,
  ClipboardCheck,
  CloudOff,
  Database,
  Download,
  FileCheck2,
  FileSearch,
  Files,
  FolderKanban,
  GitCompareArrows,
  Info,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, useParams, useSearch, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  clearAuthorizationResponseFromUrl,
  completeLogin,
  getCurrentUser,
  logout,
  onSessionExpired,
  startLogin,
} from '@/lib/auth';
import {
  canonicalAppOrigin,
  isApiConfigured,
  isAuthConfigured,
  isReplitHost,
} from '@/lib/config';
import {
  ApiNotConfiguredError,
  ApiRequestError,
  analyzeDocument,
  createProject,
  downloadDocument,
  getAnalysis,
  listDocuments,
  listProjectDocuments,
  listProjects,
  type AnalysisResponse,
  type AnalysisSourceRecord,
  type OfferAnalysisResult,
  type Project,
  type SogoDocument,
  type ApiRole,
} from '@/lib/api';
import {
  createPurchaseArea,
  getPurchaseArea,
  listPurchaseAreas,
  type PurchaseArea,
  type PurchaseAreaListResponse,
} from '@/lib/purchase-areas-api';
import {
  confirmPurchaseAreaSwitch,
  getLastPurchaseAreaId,
  projectAreaPath,
  ProjectAreaProvider,
  purchaseAreaKey,
  rememberPurchaseArea,
  registerPurchaseAreaDirtyGuard,
  useProjectArea,
  withPurchaseAreaQueryKey,
} from '@/lib/project-area-context';
import { ApiSessionProvider, ACCESS_DENIED_MESSAGE, useApiSession } from '@/lib/app-session';
import { displayAnalysisTerms, displayAnalysisValue, displaySourceRecordContent } from '@/lib/analysis-display';
import { getProjectAccessState } from '@/lib/project-access-state';
import { PurchaseThreadPage } from '@/components/purchase-thread-page';
import { ComparisonDetailPage, ComparisonsHistoryPage, ComparisonsNewPage } from '@/components/comparison-navigation';
import { UsersAdminPage } from '@/components/users-admin-page';
import { HelpPage } from '@/components/help-page';
import { InvoiceDetailPage } from '@/components/InvoiceDetailPage';
import { InvoiceListPage } from '@/components/InvoiceListPage';
import { PurchaseAreasPage } from '@/components/purchase-areas-page';
import { AwsCostsCard } from '@/components/aws-costs-card';
import {
  DetachAreaDocumentButton,
  ProjectDocumentLibraryPicker,
} from '@/components/project-document-library';
import { DocumentTypeSelect } from '@/components/document-type-select';
import { DocumentUploadDialog } from '@/components/document-upload-dialog';
import { canAnalyzeOffer, documentTypeOf, isOfferResultDocument } from '@/lib/document-types';

const queryClient = new QueryClient();
const setupMessage = 'Dane są chwilowo niedostępne';
const isConfigured = Boolean(isApiConfigured() && isAuthConfigured());

type IconType = typeof LayoutDashboard;
type ConnectionKind = 'missing' | 'unauthorized' | 'server' | 'empty';
const ShellMenuContext = createContext<(() => void) | null>(null);

const navItems: { href: string; label: string; icon: IconType; shortcut: string }[] = [
  { href: '/projects', label: 'Projekty', icon: FolderKanban, shortcut: '01' },
  { href: '/faktury', label: 'Faktury', icon: FileCheck2, shortcut: '02' },
  { href: '/users', label: 'Użytkownicy', icon: UsersRound, shortcut: '03' },
  { href: '/help', label: 'Pomoc', icon: Info, shortcut: '04' },
];

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function PolishDate({ value }: { value?: string }) {
  if (!value) return <span data-testid="text-date-not-available">—</span>;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return <span data-testid="text-date-invalid">—</span>;
  return (
    <span data-testid="text-date">
      {new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed)}
    </span>
  );
}

function Pln({ value, gross = false }: { value?: number | null; gross?: boolean }) {
  return (
    <span data-testid={gross ? 'value-pln-brutto' : 'value-pln-netto'}>
      {value == null ? 'Do ustalenia' : `${new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value)} ${gross ? 'brutto' : 'netto'}`}
    </span>
  );
}

function BrandMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className="flex items-center gap-3" data-testid="brand-sogo">
      <div className={cn('relative grid h-10 w-10 place-items-center rounded-[13px] border', inverse ? 'border-white/20 bg-white/10' : 'border-foreground/10 bg-foreground')}>
        <span className={cn('absolute h-4 w-4 -translate-x-[3px] -translate-y-[3px] rounded-[5px] border-[3px]', inverse ? 'border-primary' : 'border-primary')} />
        <span className={cn('absolute h-4 w-4 translate-x-[3px] translate-y-[3px] rounded-[5px] border-[3px]', inverse ? 'border-white/75' : 'border-card')} />
      </div>
      <div>
        <div className={cn('font-display text-xl font-bold tracking-[-0.04em] leading-none', inverse ? 'text-sidebar-foreground' : 'text-foreground')}>SOGO</div>
        <div className={cn('mt-1 font-mono text-[9px] uppercase tracking-[0.2em]', inverse ? 'text-sidebar-foreground/50' : 'text-muted-foreground')}>zakupy budowlane</div>
      </div>
    </div>
  );
}

function ConnectionState({
  kind,
  title,
  detail,
  action = true,
  onRetry,
}: {
  kind: ConnectionKind;
  title?: string;
  detail?: string;
  action?: boolean | ReactNode;
  onRetry?: () => void;
}) {
  const copy = {
    missing: { icon: CloudOff, label: 'Dane chwilowo niedostępne', text: 'Nie można teraz połączyć się z usługą. Spróbuj ponownie później.' },
    unauthorized: { icon: LockKeyhole, label: 'Zaloguj się', text: 'Twoja sesja nie jest aktywna. Zaloguj się, aby kontynuować.' },
    server: { icon: CircleAlert, label: 'Nie udało się pobrać danych', text: 'Wystąpił problem po stronie usługi. Spróbuj ponownie.' },
    empty: { icon: Files, label: 'Brak danych', text: 'Nie ma jeszcze danych do wyświetlenia w tym widoku.' },
  }[kind];
  const Icon = copy.icon;
  return (
    <div className="sogo-rise rounded-[18px] border border-dashed border-border bg-card/70 p-8 text-center md:p-12" data-testid={`state-${kind}`}>
      <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-muted-foreground">
        <Icon size={22} strokeWidth={1.7} />
      </div>
      <p className="font-display text-lg font-semibold tracking-[-0.02em]" data-testid={`status-title-${kind}`}>{title ?? copy.label}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground" data-testid={`status-detail-${kind}`}>{detail ?? copy.text}</p>
      {typeof action !== 'boolean' ? (
        <div className="mt-6">{action}</div>
      ) : action && kind !== 'empty' ? (
        <button
          type="button"
          onClick={() => {
            if (onRetry) {
              onRetry();
              return;
            }
            if (kind === 'unauthorized') {
              void startLogin().catch(() => window.location.reload());
              return;
            }
            window.location.reload();
          }}
          className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold text-foreground hover:border-foreground/30 disabled:opacity-50"
          data-testid={`button-retry-${kind}`}
        >
          {kind === 'unauthorized' ? 'Zaloguj ponownie' : 'Sprawdź ponownie'}
          <ArrowUpRight size={15} />
        </button>
      ) : null}
    </div>
  );
}

function connectionKindForError(error: unknown): ConnectionKind {
  if (error instanceof ApiNotConfiguredError) return 'missing';
  if (error instanceof ApiRequestError && error.status === 401) return 'unauthorized';
  return 'server';
}

function connectionErrorDetail(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Zaloguj się, aby kontynuować.';
    if (error.status === 404) return 'Nie znaleziono wskazanych danych albo nie masz do nich dostępu.';
    if (error.status >= 500) return 'Wystąpił problem po stronie usługi. Spróbuj ponownie.';
  }
  return fallback;
}

function mutationErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) return connectionErrorDetail(error, fallback);
  return error instanceof Error ? error.message : fallback;
}

function formatDocumentSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KiB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

const supportedDocumentExtensions = ['.pdf', '.xlsx', '.png', '.jpg', '.jpeg'] as const;

function isSupportedDocumentFile(file: File) {
  const name = file.name.toLowerCase();
  return supportedDocumentExtensions.some((extension) => name.endsWith(extension));
}

function documentStatusLabel(status: SogoDocument['status']) {
  return status === 'UPLOAD_PENDING' ? 'Oczekuje na wgranie' : status === 'UPLOADED' ? 'Wgrano' : status;
}

function isOfferPdf(document: SogoDocument) {
  return documentTypeOf(document) === 'OFFER'
    && (document.contentType.toLowerCase() === 'application/pdf' || document.filename.toLowerCase().endsWith('.pdf'));
}

function canStartOfferAnalysis(document: SogoDocument) {
  return canAnalyzeOffer(document)
    && document.status === 'UPLOADED'
    && !['QUEUED', 'OCR', 'ANALYZING', 'RETRY_WAIT', 'NEEDS_REVIEW'].includes(document.analysisStatus ?? '');
}

function isAnalysisActive(document: SogoDocument) {
  return document.analysisStatus === 'QUEUED' || document.analysisStatus === 'OCR' || document.analysisStatus === 'ANALYZING' || document.analysisStatus === 'RETRY_WAIT';
}

function analysisRefetchInterval(documents: SogoDocument[] | undefined) {
  if (documents?.some((document) => document.analysisStatus === 'QUEUED' || document.analysisStatus === 'OCR' || document.analysisStatus === 'ANALYZING')) return 10_000;
  if (documents?.some((document) => document.analysisStatus === 'RETRY_WAIT')) return 30_000;
  return false;
}

function analysisStatusLabel(status?: SogoDocument['analysisStatus']) {
  if (status === 'QUEUED') return 'W kolejce';
  if (status === 'OCR') return 'Odczytywanie PDF';
  if (status === 'ANALYZING') return 'Analizowanie oferty';
  if (status === 'RETRY_WAIT') return 'Oczekiwanie na ponowienie';
  if (status === 'NEEDS_REVIEW') return 'Do sprawdzenia';
  if (status === 'FAILED') return 'Analiza nieudana';
  if (status == null || status === '') return 'Nie rozpoczęto analizy';
  return 'Status analizy nieustalony';
}

function analysisStatusClass(status?: SogoDocument['analysisStatus']) {
  if (status === 'FAILED') return 'text-destructive';
  if (status === 'RETRY_WAIT') return 'text-primary';
  if (status === 'NEEDS_REVIEW') return 'text-accent';
  if (isAnalysisActive({ analysisStatus: status } as SogoDocument)) return 'text-primary';
  return 'text-muted-foreground';
}

function textValue(value: unknown, emptyLabel = 'Brak danych') {
  return displayAnalysisValue(value, emptyLabel);
}

function listValue(value: unknown) {
  if (!Array.isArray(value)) return value == null ? [] : [displayAnalysisValue(value)];
  return value.filter((item) => item !== null && item !== undefined && item !== '').map((item) => displayAnalysisValue(item));
}

function analysisErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Sesja wygasła lub nie masz uprawnień do pobrania wyniku analizy.';
    if (error.status === 404) return 'Wynik analizy nie został znaleziony.';
    if (error.status >= 500) return 'Backend nie odpowiedział poprawnie podczas pobierania wyniku analizy.';
  }
  return 'Nie udało się pobrać wyniku analizy z backendu.';
}

function AnalysisStatusBadge({ document }: { document: SogoDocument }) {
  if (!isOfferPdf(document)) return null;
  return (
    <span className={cn('shrink-0 rounded-full bg-secondary px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em]', analysisStatusClass(document.analysisStatus))}>
      {analysisStatusLabel(document.analysisStatus)}
    </span>
  );
}

function ConfigBanner() {
  return (
    <div className="flex items-start gap-3 border-b border-primary/25 bg-primary/10 px-5 py-3 text-sm text-foreground md:items-center" data-testid="banner-configuration">
      <Info size={17} className="mt-0.5 shrink-0 text-accent md:mt-0" />
      <p><span className="font-semibold">Środowisko oczekuje na konfigurację.</span> {setupMessage}. Akcje zależne od backendu są wyłączone.</p>
    </div>
  );
}

function Sidebar({ open, onClose, role, authUserId }: { open: boolean; onClose: () => void; role?: ApiRole; authUserId: string | null | undefined }) {
  const [location] = useLocation();
  const projectScoped = location.startsWith('/projects/');
  const invoiceScoped = location.startsWith('/faktury/');
  const visibleNavItems = navItems.filter((item) => item.href !== '/users' || role === 'ADMIN');
  return (
    <>
      {open && <button type="button" className={cn('fixed inset-0 z-30 bg-foreground/30', projectScoped ? '' : 'md:hidden')} onClick={onClose} aria-label="Zamknij menu" data-testid="button-close-menu-overlay" />}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col overflow-y-auto bg-sidebar text-sidebar-foreground transition-transform duration-200',
        projectScoped ? (open ? 'translate-x-0' : '-translate-x-full') : cn('lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full'),
      )} data-testid="sidebar">
        <div className="flex h-[88px] items-center justify-between px-6">
          <BrandMark inverse />
           <button type="button" onClick={onClose} className={cn('rounded-lg p-2 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground', projectScoped ? '' : 'lg:hidden')} aria-label="Zamknij menu" data-testid="button-close-menu"><X size={18} /></button>
        </div>
        <div className="mx-5 border-t border-sidebar-border" />
        <div className="px-4 pt-7">
          <p className="px-3 font-mono text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/40">Przestrzeń robocza</p>
          <nav className="mt-3 space-y-1" aria-label="Główna nawigacja">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const active = location === item.href || (item.href === '/projects' && projectScoped) || (item.href === '/faktury' && invoiceScoped);
              return (
                <Link
                  key={`${item.label}-${item.shortcut}`}
                  href={item.href}
                  onClick={onClose}
                  className={cn('group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold', active ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground')}
                  data-testid={`link-nav-${item.label.toLowerCase()}`}
                >
                  <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
                  <span className="flex-1">{item.label}</span>
                  <span className={cn('font-mono text-[10px]', active ? 'text-primary' : 'text-sidebar-foreground/30')}>{item.shortcut}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        {role === 'ADMIN' && <AwsCostsCard role={role} authUserId={authUserId} menuOpen={open} />}
        <div className="mt-auto px-5 pb-5">
          <div className="border-t border-sidebar-border pt-4 text-xs leading-5 text-sidebar-foreground/45">Wybierz projekt, aby przejść do dokumentów i ofert.</div>
        </div>
      </aside>
    </>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const [location] = useLocation();
  const session = useApiSession();
  const breadcrumb = location === '/faktury' ? 'Faktury' : location.startsWith('/faktury/') ? 'Faktura' : location === '/help' ? 'Pomoc' : location === '/users' ? 'Użytkownicy' : location === '/projects' ? 'Projekty' : location.includes('/scope') ? 'Do kupienia' : location.includes('/documents') ? 'Dokumenty' : location.includes('/comparisons') ? 'Oferty' : location.includes('/assistant') ? 'Asystent' : 'Projekt';

  return (
    <header className="flex h-[72px] items-center justify-between border-b border-border bg-card/75 px-5 backdrop-blur md:px-8" data-testid="topbar">
      <div className="flex min-w-0 items-center gap-3">
         <button type="button" className="rounded-xl border border-border p-2 text-muted-foreground hover:bg-secondary lg:hidden" onClick={onMenu} aria-label="Otwórz menu" data-testid="button-open-menu"><Menu size={19} /></button>
        <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
          <span className="font-mono uppercase tracking-[0.16em]">SOGO</span><ChevronRight size={13} /><span className="font-semibold text-foreground">{breadcrumb}</span>
        </div>
        <span className="font-display text-base font-bold sm:hidden">{breadcrumb}</span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => void logout()} disabled={!isAuthConfigured() || session.sessionEnding} className="ml-1 flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-xs font-bold text-foreground hover:bg-secondary/70 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Wyloguj" title="Wyloguj" data-testid="button-logout"><UserRound size={16} /></button>
      </div>
    </header>
  );
}

function AppShell({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const isProjectWorkspace = location.startsWith('/projects/');
  const { projectId } = useParams<{ projectId?: string }>();
  const session = useApiSession();
  const projectAccessQuery = useQuery({
    queryKey: ['projects', session.authUserId],
    queryFn: listProjects,
    enabled: isConfigured && Boolean(projectId) && Boolean(session.user),
    retry: false,
    staleTime: 15_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: projectId ? 30_000 : false,
  });
  const projectAccessState = projectId && session.authUserId
    ? getProjectAccessState({
        projectId,
        projects: projectAccessQuery.data,
        isFetchedAfterMount: projectAccessQuery.isFetchedAfterMount,
        isError: projectAccessQuery.isError,
        isFetching: projectAccessQuery.isFetching,
      })
    : 'granted';

  useEffect(() => {
    if (!isConfigured || session.authPending) return;
    if (session.authError || !session.authUserId) {
      setLocation('/');
      return;
    }
    if (session.userError instanceof ApiRequestError && session.userError.status === 401) {
      setLocation('/');
      return;
    }
    if (adminOnly && session.user && session.user.role !== 'ADMIN') {
      setLocation('/projects');
      return;
    }
  }, [
    adminOnly,
    session.authError,
    session.authPending,
    session.authUserId,
    session.user,
    session.userError,
    setLocation,
  ]);

  if (isConfigured && (session.authPending || session.userPending || (projectId && session.user && projectAccessState === 'checking'))) {
    return <div className="sogo-noise grid min-h-[100dvh] place-items-center bg-background p-5"><div className="w-full max-w-lg"><LoadingState label="Sprawdzanie dostępu…" /></div></div>;
  }
  if (isConfigured && !session.authUserId) return null;
  if (isConfigured && session.authError) {
    return <div className="sogo-noise grid min-h-[100dvh] place-items-center bg-background p-5"><div className="w-full max-w-lg"><ConnectionState kind="unauthorized" title="Nie udało się odczytać sesji" detail="Zaloguj się ponownie, aby kontynuować." /></div></div>;
  }
  if (isConfigured && session.userError && !(session.userError instanceof ApiRequestError && session.userError.status === 401)) {
    return <div className="sogo-noise grid min-h-[100dvh] place-items-center bg-background p-5"><div className="w-full max-w-lg"><ConnectionState kind={connectionKindForError(session.userError)} title="Nie udało się sprawdzić dostępu" detail={connectionErrorDetail(session.userError, 'Spróbuj ponownie za chwilę.')} /></div></div>;
  }
  if (projectId && projectAccessState === 'error') {
    return <div className="sogo-noise grid min-h-[100dvh] place-items-center bg-background p-5"><div className="w-full max-w-lg"><ConnectionState kind={connectionKindForError(projectAccessQuery.error)} title="Nie udało się sprawdzić projektu" detail={connectionErrorDetail(projectAccessQuery.error, 'Wróć do listy projektów i spróbuj ponownie.')} onRetry={projectAccessQuery.error instanceof ApiRequestError && projectAccessQuery.error.status === 401 ? undefined : () => { void projectAccessQuery.refetch(); }} /></div></div>;
  }
  if (projectId && projectAccessState === 'denied') return <ProjectAccessDeniedState />;
  if (isConfigured && adminOnly && session.user?.role !== 'ADMIN') return null;

  return (
    <ShellMenuContext.Provider value={() => setMenuOpen(true)}>
      <div className="sogo-noise flex min-h-[100dvh] bg-background text-foreground">
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} role={session.user?.role} authUserId={session.authUserId} />
        <div className="flex min-w-0 flex-1 flex-col">
          {!isProjectWorkspace && <Topbar onMenu={() => setMenuOpen(true)} />}
          <main className={cn('sogo-grid min-h-0 overflow-auto', isProjectWorkspace ? 'sogo-project-viewport flex-none' : 'flex-1')}>{children}</main>
        </div>
      </div>
    </ShellMenuContext.Provider>
  );
}

function SectionHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-5 border-b border-border pb-7 md:flex-row md:items-end">
      <div>
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-accent" data-testid={`eyebrow-${eyebrow.toLowerCase().replaceAll(' ', '-')}`}>{eyebrow}</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.045em] md:text-[40px]" data-testid={`heading-${title.toLowerCase().replaceAll(' ', '-')}`}>{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function DisabledButton({ children, icon: Icon = Plus, label, className }: { children: ReactNode; icon?: IconType; label: string; className?: string }) {
  return (
    <button type="button" disabled className={cn('inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground opacity-55', className)} data-testid={`button-${label}`}>
      <Icon size={16} /> {children}
    </button>
  );
}

function Home() {
  const [loginError, setLoginError] = useState('');

  async function handleLogin() {
    setLoginError('');
    try {
      await startLogin();
    } catch {
      setLoginError('Nie udało się rozpocząć logowania. Spróbuj ponownie.');
    }
  }

  return (
    <div className="sogo-public-entry min-h-[100svh] overflow-x-clip bg-background text-foreground">
      <div className="mx-auto flex min-h-[100svh] w-full max-w-[1440px] flex-col px-5 py-5 sm:px-8 sm:py-7 lg:px-12 lg:py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <BrandMark />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:text-xs">Zakupy budowlane</span>
        </header>
        <main className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] content-start items-start gap-9 py-8 sm:py-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:content-center lg:items-center lg:gap-14 xl:gap-20">
          <section className="min-w-0 max-w-2xl" aria-labelledby="heading-sogo-entry">
            <h1 className="max-w-[18ch] font-display text-[clamp(1.7rem,5.2vw,4.5rem)] font-bold leading-[1.04] tracking-[-0.055em] sm:text-[clamp(2.35rem,5.2vw,4.5rem)]" data-testid="heading-sogo-entry">
              Porównaj oferty.
              <span className="block text-accent">Przygotuj zakupy na budowę.</span>
            </h1>
            <p className="mt-5 max-w-[62ch] text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
              Dodaj oferty dostawców, porównaj ceny i pobierz zestawienie APO w Excelu. Potrzebujesz zmiany? Napisz asystentowi, co ma poprawić.
            </p>
            <div className="mt-7 flex flex-col items-start gap-3">
              {isAuthConfigured() ? (
                <button
                  type="button"
                  onClick={handleLogin}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground hover:-translate-y-0.5 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  data-testid="button-rozpocznij-logowanie"
                >
                  <LockKeyhole size={16} aria-hidden="true" /> Zaloguj się
                </button>
              ) : (
                <DisabledButton label="rozpocznij-logowanie" icon={LockKeyhole}>Zaloguj się</DisabledButton>
              )}
              <p className="text-xs leading-5 text-muted-foreground">Dostęp do projektów przydziela administrator.</p>
            </div>
            {loginError && <p className="mt-3 text-sm text-destructive" role="alert">{loginError}</p>}
          </section>

          <section className="min-w-0 lg:pl-2" aria-labelledby="heading-workflow">
            <h2 id="heading-workflow" className="font-display text-xl font-bold tracking-[-0.03em] sm:text-2xl">Od oferty do gotowego zestawienia</h2>
            <ol className="mt-4 divide-y divide-border/80">
              <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-4 first:pt-0">
                <span className="pt-0.5 font-mono text-xs font-medium tracking-[0.08em] text-accent">01</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold sm:text-base">Dodaj oferty</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm sm:leading-6">Wgraj dokumenty od dostawców do projektu.</p>
                </div>
              </li>
              <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-4">
                <span className="pt-0.5 font-mono text-xs font-medium tracking-[0.08em] text-accent">02</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold sm:text-base">Porównaj wspólną listę materiałów</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm sm:leading-6">Zestaw ceny dla tych samych materiałów i ilości.</p>
                </div>
              </li>
              <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-4">
                <span className="pt-0.5 font-mono text-xs font-medium tracking-[0.08em] text-accent">03</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold sm:text-base">Wprowadź zmiany rozmową</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm sm:leading-6">Napisz np. „Przyjmij 13 wpustów” lub „Transport u tego dostawcy jest gratis”.</p>
                </div>
              </li>
              <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-4 last:pb-0">
                <span className="pt-0.5 font-mono text-xs font-medium tracking-[0.08em] text-accent">04</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold sm:text-base">Pobierz APO</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm sm:leading-6">Wyeksportuj zestawienie uwzględniające zapisane ustalenia.</p>
                </div>
              </li>
            </ol>
          </section>
        </main>
        <footer className="mt-4 border-t border-border/80 pt-4 text-[11px] text-muted-foreground">SOGO · Zakupy budowlane</footer>
      </div>
    </div>
  );
}

function AuthCallback() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [callbackError, setCallbackError] = useState('');

  useEffect(() => {
    if (isReplitHost()) {
      window.location.replace(`${canonicalAppOrigin}/auth/callback${window.location.search}${window.location.hash}`);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const isAuthorizationResponse = params.has('code') || params.has('error');
    if (!isAuthConfigured() || !isAuthorizationResponse) {
      return;
    }

    void completeLogin()
      .then(async () => {
        clearAuthorizationResponseFromUrl();
        await queryClient.invalidateQueries({ queryKey: ['sogo-auth-session'] });
        navigate('/projects');
      })
      .catch(() => {
        clearAuthorizationResponseFromUrl();
        setCallbackError('Nie udało się zakończyć logowania. Kod, state lub nonce może być nieważny albo wygasły.');
      });
  }, [navigate, queryClient]);

  return (
    <div className="sogo-noise min-h-[100dvh] bg-background px-6 py-8 md:px-12">
      <header className="mx-auto flex max-w-6xl items-center justify-between"><BrandMark /><Link href="/" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="link-back-home"><ArrowLeft size={16} /> Wróć do wejścia</Link></header>
      <main className="mx-auto grid max-w-6xl items-center gap-10 py-20 lg:grid-cols-[0.7fr_1.3fr]">
        <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">LOGOWANIE</p><h1 className="mt-4 font-display text-4xl font-bold tracking-[-0.05em] md:text-6xl">Wróć do<br />SOGO.</h1><p className="mt-6 max-w-md leading-7 text-muted-foreground">Po zalogowaniu wrócisz do swoich projektów i dokumentów.</p></div>
        <div className="rounded-[24px] border border-border bg-card p-7 shadow-lg md:p-10" data-testid="card-callback-state"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/20 text-accent"><ShieldAlert size={23} /></div><h2 className="mt-6 font-display text-xl font-bold">{callbackError ? 'Nie udało się dokończyć logowania' : 'Zaloguj się, aby kontynuować'}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{callbackError || 'Ta strona obsługuje powrót po logowaniu. Wróć do strony startowej i rozpocznij logowanie.'}</p><Link href="/" className="mt-7 inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground">Wróć do logowania</Link></div>
      </main>
    </div>
  );
}

function ProjectsPage() {
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [projectName, setProjectName] = useState('');
  const queryClient = useQueryClient();
  const session = useApiSession();
  const projectsQuery = useQuery({
    queryKey: ['projects', session.authUserId],
    queryFn: listProjects,
    enabled: Boolean(session.authUserId) && isApiConfigured() && isAuthConfigured(),
    retry: false,
    staleTime: 15_000,
  });
  const createMutation = useMutation({
    mutationFn: (name: string) => createProject(name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      setProjectName('');
      setShowCreate(false);
    },
  });

  const projects = projectsQuery.data ?? [];
  const filteredProjects = projects.filter((project) =>
    project.name.toLocaleLowerCase('pl-PL').includes(search.trim().toLocaleLowerCase('pl-PL')),
  );
  const unavailableKind: ConnectionKind = isApiConfigured() ? 'unauthorized' : 'missing';
  const hasConfiguration = isApiConfigured() && isAuthConfigured();

  function submitProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = projectName.trim();
    if (name) {
      createMutation.mutate(name);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10">
      <SectionHeading
        eyebrow="01 / PRZESTRZEŃ"
        title="Projekty"
         description="Miejsce startowe dla dokumentów i porównań ofert."
        action={session.user?.role === 'ADMIN' ? (
          <button
            type="button"
            onClick={() => setShowCreate((visible) => !visible)}
            disabled={!hasConfiguration || createMutation.isPending}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="button-utworz-projekt"
          >
            <Plus size={16} /> Nowy projekt
          </button>
        ) : undefined}
      />
      {showCreate && session.user?.role === 'ADMIN' && (
        <form onSubmit={submitProject} className="mt-5 flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:flex-row" data-testid="form-create-project">
          <label className="min-w-0 flex-1">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Nazwa projektu</span>
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Np. Żurawiniec"
              maxLength={160}
              autoFocus
              required
              className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              data-testid="input-project-name"
            />
          </label>
          <button type="submit" disabled={!projectName.trim() || createMutation.isPending} className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-submit-project">
            {createMutation.isPending ? 'Tworzenie…' : 'Utwórz projekt'}
          </button>
          <button type="button" onClick={() => { setShowCreate(false); setProjectName(''); }} className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-bold text-foreground" data-testid="button-cancel-project">
            Anuluj
          </button>
        </form>
      )}
      {createMutation.isError && <p className="mt-3 text-sm text-destructive" role="alert">{mutationErrorMessage(createMutation.error, 'Nie udało się utworzyć projektu.')}</p>}
      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block max-w-md flex-1"><Search size={16} className="absolute left-3.5 top-3.5 text-muted-foreground" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj po nazwie projektu" className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20" data-testid="input-search-projects" /></label>
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><SlidersHorizontal size={15} /> <span data-testid="text-project-filter">Wszystkie projekty</span></div>
      </div>
      <div className="mt-5">
         {!hasConfiguration ? (
           <ConnectionState kind={unavailableKind} detail={isApiConfigured() ? 'Zaloguj się, aby zobaczyć projekty.' : undefined} />
        ) : projectsQuery.isPending ? (
          <LoadingState label="Pobieranie projektów…" />
        ) : projectsQuery.isError ? (
           <ConnectionState kind={connectionKindForError(projectsQuery.error)} title="Nie udało się pobrać projektów" detail={connectionErrorDetail(projectsQuery.error, 'Spróbuj ponownie za chwilę.')} />
        ) : filteredProjects.length === 0 ? (
          <ConnectionState kind="empty" title={search ? `Nie znaleziono projektu „${search}”` : 'Brak projektów'} detail={search ? 'Spróbuj innej nazwy.' : 'Backend nie zwrócił jeszcze żadnego projektu dla tej sesji.'} action={false} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="list-projects">
            {filteredProjects.map((project) => <ProjectCard key={project.projectId} project={project} />)}
          </div>
        )}
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <Metric label="Projekty dostępne" value={hasConfiguration && !projectsQuery.isError ? String(projects.length) : '—'} icon={FolderKanban} />
         <Metric label="Dokumenty źródłowe" value="—" icon={Files} />
      </div>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return <div className="rounded-[18px] border border-dashed border-border bg-card/70 p-8 text-center text-sm text-muted-foreground" data-testid="state-loading">{label}</div>;
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <Link href={`/projects/${project.projectId}`} className="group rounded-2xl border border-border bg-card/70 p-5 transition hover:-translate-y-0.5 hover:border-foreground/25" data-testid={`link-project-${project.projectId}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-accent"><FolderKanban size={19} /></div>
        <ArrowUpRight size={17} className="text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
      <p className="mt-6 font-display text-xl font-bold tracking-[-0.03em]">{project.name}</p>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Utworzono <PolishDate value={project.createdAt} /></p>
    </Link>
  );
}

function StateLegend({ tone, title, detail }: { tone: 'primary' | 'accent' | 'danger' | 'muted'; title: string; detail: string }) {
  const dotClass = { primary: 'bg-primary', accent: 'bg-accent', danger: 'bg-destructive', muted: 'bg-muted-foreground' }[tone];
  return <div className="rounded-xl border border-border bg-background/70 p-3"><div className="flex items-center gap-2 text-xs font-bold"><span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />{title}</div><p className="mt-2 text-[11px] leading-5 text-muted-foreground">{detail}</p></div>;
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: IconType }) {
  return <div className="rounded-2xl border border-border bg-card/70 p-5" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}><div className="flex items-center justify-between text-muted-foreground"><span className="text-xs font-semibold">{label}</span><Icon size={17} /></div><p className="mt-5 font-display text-3xl font-bold tracking-[-0.05em]">{value}</p></div>;
}

function ProjectHeader({ projectId, areaName }: { projectId: string; areaName?: string }) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const openShellMenu = useContext(ShellMenuContext);
  const queryClient = useQueryClient();
  const session = useApiSession();
  const { purchaseAreaId } = useProjectArea();
  const areaKey = purchaseAreaKey(purchaseAreaId);
  const [createOpen, setCreateOpen] = useState(false);
  const [newAreaName, setNewAreaName] = useState('');
  const [nameError, setNameError] = useState('');
  const createRequest = useRef<{ name: string; requestId: string } | null>(null);
  const projectsQuery = useQuery({
    queryKey: ['projects', session.authUserId],
    queryFn: listProjects,
    enabled: Boolean(session.authUserId) && isApiConfigured() && isAuthConfigured(),
    retry: false,
    staleTime: 15_000,
  });
  const areasQuery = useQuery({
    queryKey: ['purchase-areas', projectId],
    queryFn: ({ signal }) => listPurchaseAreas(projectId, signal),
    enabled: Boolean(session.authUserId) && isApiConfigured() && isAuthConfigured(),
    retry: false,
    staleTime: 10_000,
  });
  const project = projectsQuery.data?.find((item) => item.projectId === projectId);
  const generalArea: PurchaseArea = {
    projectId,
    purchaseAreaId: null,
    name: 'Ogólne',
    isGeneral: true,
    version: 0,
  };
  const areaItems = areasQuery.data?.items ?? [];
  const general = areaItems.find((area) => area.isGeneral || area.purchaseAreaId === null) ?? generalArea;
  const options = [general, ...areaItems.filter((area) => !area.isGeneral && area.purchaseAreaId !== null)];
  if (purchaseAreaId && !options.some((area) => area.purchaseAreaId === purchaseAreaId)) {
    options.push({
      projectId,
      purchaseAreaId,
      name: areaName ?? 'Temat zakupów',
      isGeneral: false,
      version: 0,
    });
  }
  const currentProjectName = projectsQuery.isPending ? 'Ładowanie projektu…' : project?.name ?? 'Projekt';
  const isWorkspaceRoute = /\/(?:scope|assistant)$/.test(location.split('?')[0]);
  const workspaceTab = new URLSearchParams(search).get('workspace');
  const createMutation = useMutation({
    mutationFn: async (input: { name: string; requestId: string }) => {
      const response = await createPurchaseArea(projectId, input.name, input.requestId);
      if (!response.area.purchaseAreaId || response.area.isGeneral) {
        throw new Error('Serwer nie zwrócił nowego tematu zakupów.');
      }
      return response.area;
    },
    onSuccess: async (area) => {
      const key = ['purchase-areas', projectId] as const;
      queryClient.setQueryData<PurchaseAreaListResponse>(key, (current) => current
        ? { ...current, items: [...current.items.filter((item) => item.purchaseAreaId !== area.purchaseAreaId), area] }
        : { items: [area] },
      );
      queryClient.setQueryData(['purchase-area', projectId, area.purchaseAreaId], { area });
      createRequest.current = null;
      setCreateOpen(false);
      setNewAreaName('');
      setNameError('');
      rememberPurchaseArea(projectId, area.purchaseAreaId);
      await queryClient.invalidateQueries({ queryKey: key });
      setLocation(projectAreaPath(projectId, area.purchaseAreaId, 'scope'));
    },
  });

  function switchArea(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.currentTarget.value;
    const nextAreaId = value || null;
    if (nextAreaId === purchaseAreaId) return;
    if (!confirmPurchaseAreaSwitch()) {
      event.currentTarget.value = purchaseAreaId ?? '';
      return;
    }
    rememberPurchaseArea(projectId, nextAreaId);
    void queryClient.cancelQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return key[1] === projectId && key[key.length - 1] === areaKey;
      },
    });
    setLocation(projectAreaPath(projectId, nextAreaId, 'scope'));
  }

  function guardProjectNavigation(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!confirmPurchaseAreaSwitch('Masz niezapisane zmiany. Czy na pewno chcesz opuścić tę stronę?')) {
      event.preventDefault();
    }
  }

  function submitCreateArea(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newAreaName.trim();
    const validation = !name
      ? 'Podaj nazwę tematu zakupów.'
      : name.length > 160
        ? 'Nazwa tematu może mieć maksymalnie 160 znaków.'
        : /[\u0000-\u001f\u007f]/.test(name)
          ? 'Nazwa nie może zawierać znaków kontrolnych.'
          : '';
    setNameError(validation);
    if (validation || !confirmPurchaseAreaSwitch()) return;
    if (createRequest.current?.name !== name) {
      createRequest.current = { name, requestId: crypto.randomUUID() };
    }
    createMutation.mutate(createRequest.current);
  }

  function closeCreateArea() {
    if (createMutation.isPending) return;
    setCreateOpen(false);
    setNewAreaName('');
    setNameError('');
    createRequest.current = null;
    createMutation.reset();
  }

  return (
    <>
      <header className="sticky top-0 z-20 flex h-14 min-w-0 items-center gap-2 border-b border-border bg-card/95 px-3 backdrop-blur sm:px-4" data-testid="project-workspace-header">
        <button type="button" onClick={() => openShellMenu?.()} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-secondary" aria-label="Otwórz nawigację aplikacji" title="Nawigacja aplikacji" data-testid="button-project-open-menu"><Menu size={17} /></button>
        <Link href="/projects" onClick={guardProjectNavigation} className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg px-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground sm:px-2" aria-label="Wróć do projektów" data-testid="link-projects-breadcrumb">
          <ArrowLeft size={16} /><span className="hidden text-xs font-semibold sm:inline">Projekty</span>
        </Link>
        <span className="min-w-0 flex-1 truncate font-display text-sm font-bold tracking-tight sm:text-base" data-testid="text-project-name">{currentProjectName}</span>
        <select
          value={purchaseAreaId ?? ''}
          onChange={switchArea}
          className="h-9 max-w-[38vw] min-w-[112px] shrink-0 rounded-lg border border-input bg-background px-2 text-xs font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 sm:max-w-[15rem] sm:px-3 sm:text-sm"
          data-testid="select-project-purchase-area"
          aria-label="Temat"
        >
          {options.map((area) => <option key={area.purchaseAreaId ?? 'general'} value={area.purchaseAreaId ?? ''}>{area.name}</option>)}
        </select>
        <button
          type="button"
          onClick={() => {
            setNewAreaName('');
            setNameError('');
            createMutation.reset();
            setCreateOpen(true);
          }}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg border border-border bg-background px-2 text-xs font-semibold hover:bg-secondary sm:px-3"
          aria-label="Dodaj temat zakupów"
          data-testid="button-add-purchase-area"
          title="Dodaj temat"
        >
          <Plus size={14} /><span className="hidden sm:inline">Dodaj temat</span>
        </button>
        <button type="button" onClick={() => void logout()} disabled={!isAuthConfigured() || session.sessionEnding} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50" aria-label="Wyloguj" title="Wyloguj" data-testid="button-logout"><UserRound size={16} /></button>
      </header>
      {areasQuery.isError && <p className="px-4 py-1.5 text-[11px] text-destructive" role="status">Nie udało się odświeżyć listy tematów.</p>}
      {createOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-foreground/30 p-4" role="presentation">
          <form onSubmit={submitCreateArea} className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="create-purchase-area-title" data-testid="dialog-create-purchase-area">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="create-purchase-area-title" className="font-display text-lg font-bold">Dodaj temat</h2>
                <p className="mt-1 text-xs text-muted-foreground">Nowy temat otworzy własną rozmowę, listę materiałów i dokumenty.</p>
              </div>
              <button type="button" onClick={closeCreateArea} disabled={createMutation.isPending} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary disabled:opacity-50" aria-label="Zamknij"><X size={16} /></button>
            </div>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-semibold">Nazwa tematu</span>
              <input value={newAreaName} onChange={(event) => setNewAreaName(event.target.value)} maxLength={160} autoFocus className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="Np. Instalacje sanitarne" />
            </label>
            {nameError && <p className="mt-2 text-xs text-destructive" role="alert">{nameError}</p>}
            {createMutation.isError && <p className="mt-2 text-xs text-destructive" role="alert">{mutationErrorMessage(createMutation.error, 'Nie udało się utworzyć tematu. Wpisana nazwa pozostała w formularzu.')}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={closeCreateArea} disabled={createMutation.isPending} className="h-9 rounded-lg px-3 text-xs font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-50">Anuluj</button>
              <button type="submit" disabled={!newAreaName.trim() || createMutation.isPending} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground disabled:opacity-50">
                {createMutation.isPending ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
                {createMutation.isPending ? 'Tworzenie…' : 'Utwórz temat'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function ProjectAccessDeniedState() {
  return (
    <div className="sogo-noise grid min-h-[100dvh] place-items-center bg-background p-5" data-testid="state-project-access-denied">
      <div className="w-full max-w-lg rounded-[18px] border border-border bg-card p-8 text-center">
        <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-muted-foreground"><LockKeyhole size={22} /></div>
        <p className="font-display text-lg font-semibold">Brak dostępu do projektu</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Projekt nie jest dostępny na Twoim koncie.</p>
        <Link href="/projects" className="mt-6 inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-semibold hover:border-foreground/30" data-testid="link-back-to-projects">Wróć do projektów</Link>
      </div>
    </div>
  );
}

function ProjectAreaState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <main className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10" role="alert" data-testid="state-project-area-error">
      <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-6">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </main>
  );
}

function ProjectLayout({ children, fillViewport = false }: { children: ReactNode; fillViewport?: boolean }) {
  const { projectId = 'nieznany', purchaseAreaId: routeAreaId } = useParams<{ projectId: string; purchaseAreaId?: string }>();
  const [location] = useLocation();
  const purchaseAreaId = routeAreaId?.trim() || null;
  const session = useApiSession();
  const areaQuery = useQuery({
    queryKey: ['purchase-area', projectId, purchaseAreaId],
    queryFn: ({ signal }) => getPurchaseArea(projectId, purchaseAreaId!, signal),
    enabled: Boolean(purchaseAreaId && session.authUserId && isApiConfigured() && isAuthConfigured()),
    retry: false,
    staleTime: 10_000,
  });
  const areaKey = purchaseAreaKey(purchaseAreaId);
  const areaReady = !purchaseAreaId || (areaQuery.isSuccess && areaQuery.data.area.purchaseAreaId === purchaseAreaId);
  useEffect(() => {
    const projectRoot = `/projects/${projectId}`;
    if (location === projectRoot || location === `${projectRoot}/`) return;
    rememberPurchaseArea(projectId, purchaseAreaId);
  }, [location, projectId, purchaseAreaId]);
  const projectContent = purchaseAreaId && (!isApiConfigured() || !isAuthConfigured()) ? (
    <ProjectAreaState title="Obszar zakupowy jest niedostępny" detail="Nie można sprawdzić dostępu do tego obszaru zakupowego w obecnej konfiguracji." />
  ) : purchaseAreaId && areaQuery.isPending ? (
    <main className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10"><LoadingState label="Sprawdzanie dostępu do obszaru zakupowego…" /></main>
  ) : purchaseAreaId && areaQuery.isError ? (
    <ProjectAreaState
      title="Nie udało się otworzyć obszaru zakupowego"
      detail={areaQuery.error instanceof ApiRequestError && [403, 404].includes(areaQuery.error.status)
        ? 'Obszar zakupowy nie istnieje lub nie jest już dostępny dla tego projektu.'
        : 'Sprawdź połączenie i spróbuj ponownie.'}
      action={<button type="button" onClick={() => void areaQuery.refetch()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold"><RefreshCw size={15} /> Spróbuj ponownie</button>}
    />
  ) : !areaReady ? (
    <ProjectAreaState title="Obszar zakupowy jest niedostępny" detail="Nie znaleziono tego obszaru zakupowego w projekcie." />
  ) : children;

  return (
    <ProjectAreaProvider key={`${projectId}:${areaKey}`} projectId={projectId} purchaseAreaId={purchaseAreaId}>
      {fillViewport ? (
        <div className="sogo-project-viewport flex min-h-0 flex-col">
          <div className="shrink-0"><ProjectHeader projectId={projectId} areaName={areaQuery.data?.area.name} /></div>
          <div className="min-h-0 flex-1 overflow-auto">{projectContent}</div>
        </div>
      ) : (
        <>
          <ProjectHeader projectId={projectId} areaName={areaQuery.data?.area.name} />
          {projectContent}
        </>
      )}
    </ProjectAreaProvider>
  );
}

function DocumentsPage() {
  const { projectId = 'nieznany' } = useParams<{ projectId: string }>();
  const { purchaseAreaId } = useProjectArea();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadDialogFiles, setUploadDialogFiles] = useState<File[] | null>(null);
  const [uploadSelectionError, setUploadSelectionError] = useState('');
  const documentsQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['documents', projectId], purchaseAreaId),
    queryFn: ({ signal }) => purchaseAreaId
      ? listDocuments(projectId, purchaseAreaId, signal)
      : listProjectDocuments(projectId, signal),
    enabled: isApiConfigured() && isAuthConfigured(),
    retry: false,
    refetchInterval: (query) => analysisRefetchInterval(query.state.data),
  });
  const analyzeMutation = useMutation({
    mutationFn: (documentId: string) => analyzeDocument(projectId, documentId, purchaseAreaId),
    onSuccess: async () => {
      await documentsQuery.refetch();
    },
  });
  const documents = documentsQuery.data ?? [];
  const hasConfiguration = isApiConfigured() && isAuthConfigured();
  const unavailableKind: ConnectionKind = isApiConfigured() ? 'unauthorized' : 'missing';

  useEffect(() => {
    const guardKey = `document-upload:${projectId}:${purchaseAreaId ?? 'general'}`;
    const isDirty = () => Boolean(uploadDialogFiles);
    const unregister = registerPurchaseAreaDirtyGuard(guardKey, isDirty);
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      unregister();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [projectId, purchaseAreaId, uploadDialogFiles]);

  function openUploadDialog(files: File[]) {
    const supported: File[] = [];
    const rejected: string[] = [];
    files.forEach((originalFile) => {
      let file = originalFile;
      const isImageFromClipboard = originalFile.type === 'image/png' || originalFile.type === 'image/jpeg';
      if (isImageFromClipboard && !/\.[a-z0-9]+$/i.test(originalFile.name)) {
        const extension = originalFile.type === 'image/png' ? '.png' : '.jpg';
        file = new File([originalFile], `${originalFile.name || 'wklejony-obraz'}${extension}`, { type: originalFile.type, lastModified: originalFile.lastModified });
      }
      if (!isSupportedDocumentFile(file)) {
        rejected.push(file.name);
        return;
      }
      supported.push(file);
    });
    setUploadSelectionError(rejected.length
      ? `Pominięto nieobsługiwane pliki: ${rejected.join(', ')}. Obsługiwane formaty: PDF, XLSX, PNG, JPG i JPEG.`
      : '');
    if (supported.length) setUploadDialogFiles(supported);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    openUploadDialog(files);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length) openUploadDialog(files);
  }

  return (
      <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10">
        <SectionHeading
          eyebrow="02 / ŹRÓDŁA"
          title="Pliki"
          description={purchaseAreaId
            ? 'Pliki przypisane do tego obszaru zakupowego. Potwierdź ich rodzaj przed zapisaniem.'
            : 'Wspólna biblioteka plików projektu. Potwierdź rodzaj dokumentu przed zapisaniem; pliki można przypisywać do obszarów bez ponownego wgrywania.'}
          action={
            <div className="flex flex-wrap gap-2">
              <Link href={projectAreaPath(projectId, purchaseAreaId, 'scope')} className="inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-border bg-background px-4 text-sm font-bold hover:bg-secondary" data-testid="link-documents-return-to-thread">
                <ArrowLeft size={15} /> Wróć do rozmowy
              </Link>
              {purchaseAreaId && (
                <button
                  type="button"
                  onClick={() => setLibraryOpen(true)}
                  disabled={!hasConfiguration}
                  className="inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-border bg-background px-4 text-sm font-bold hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="button-open-project-document-library"
                >
                  <Files size={16} /> Dodaj z biblioteki projektu
                </button>
              )}
              <label className={cn('inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground', !hasConfiguration && 'pointer-events-none opacity-50')}>
                <input ref={fileInputRef} type="file" multiple className="sr-only" accept=".pdf,.xlsx,.png,.jpg,.jpeg" onChange={handleFileChange} disabled={!hasConfiguration} />
                <UploadCloud size={16} />{purchaseAreaId ? 'Wgraj pliki' : 'Dodaj pliki do biblioteki'}
              </label>
            </div>
          }
        />
        <p id="upload-help" className="mt-4 text-xs leading-5 text-muted-foreground">
          Przeciągnij pliki w dowolne miejsce poniżej albo wklej obraz ze schowka. Przed wgraniem potwierdź rodzaj każdego pliku. Obsługiwane formaty: PDF, XLSX, PNG, JPG i JPEG.
        </p>
        {uploadSelectionError && <p className="mt-3 text-sm text-destructive" role="alert">{uploadSelectionError}</p>}
        <div
          className={cn('mt-8 grid gap-5 lg:grid-cols-[1fr_290px]', isDragging && 'rounded-2xl ring-2 ring-primary ring-offset-4 ring-offset-background')}
          onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => { event.preventDefault(); setIsDragging(false); openUploadDialog(Array.from(event.dataTransfer.files)); }}
          onPaste={handlePaste}
          tabIndex={0}
          role="region"
          aria-labelledby="upload-help"
          aria-label="Obszar upuszczania i wklejania plików"
        >
          <div>
            {!hasConfiguration ? <ConnectionState kind={unavailableKind} title="Brak dokumentów do wyświetlenia" detail={isApiConfigured() ? 'Zaloguj się, aby zobaczyć dokumenty.' : undefined} /> :
              documentsQuery.isPending ? <LoadingState label="Pobieranie dokumentów…" /> :
              documentsQuery.isError ? <ConnectionState kind={connectionKindForError(documentsQuery.error)} title="Nie udało się pobrać dokumentów" detail={connectionErrorDetail(documentsQuery.error, 'Spróbuj ponownie za chwilę.')} /> :
              documents.length === 0 ? (
                <ConnectionState
                  kind="empty"
          title={purchaseAreaId ? 'Nie dodano jeszcze plików do tego obszaru zakupowego' : 'Biblioteka plików jest pusta'}
                  detail={purchaseAreaId
                    ? 'Wybierz oferty z biblioteki projektu lub wgraj nowy dokument.'
                    : 'Dodaj dokument do biblioteki projektu, aby móc przypisywać go do obszarów zakupowych.'}
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      {purchaseAreaId && (
                        <button
                          type="button"
                          onClick={() => setLibraryOpen(true)}
                          disabled={!hasConfiguration}
                          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-bold disabled:opacity-50"
                          data-testid="button-add-first-from-library"
                        >
                          <Files size={15} /> Dodaj z biblioteki projektu
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!hasConfiguration}
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"
                        data-testid="button-add-first-document"
                      >
                        <UploadCloud size={15} /> {purchaseAreaId ? 'Wgraj nowy dokument' : 'Dodaj dokument'}
                      </button>
                    </div>
                  }
                />
              ) :
              <div className="space-y-3" data-testid="list-documents">
                {documents.map((document) => {
                  const canAnalyze = canStartOfferAnalysis(document);
                  return (
                    <div key={document.documentId} className="rounded-2xl border border-border bg-card/70 p-4 transition hover:border-foreground/25" data-testid={`document-row-${document.documentId}`}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <Link href={projectAreaPath(projectId, purchaseAreaId, `documents/${document.documentId}`)} className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold">{document.filename}</p>
                          <p className="mt-1 text-xs text-muted-foreground"><PolishDate value={document.createdAt} /></p>
                        </Link>
                        <div className="w-full min-w-0 sm:max-w-[190px]">
                          <DocumentTypeSelect projectId={projectId} purchaseAreaId={purchaseAreaId} document={document} />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="shrink-0 rounded-full bg-secondary px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{documentStatusLabel(document.status)}</span>
                          <AnalysisStatusBadge document={document} />
                          {purchaseAreaId && <DetachAreaDocumentButton projectId={projectId} purchaseAreaId={purchaseAreaId} document={document} />}
                          {canAnalyze && (
                            <button type="button" onClick={() => analyzeMutation.mutate(document.documentId)} disabled={analyzeMutation.isPending} className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-3 text-xs font-bold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50" data-testid={`button-analyze-${document.documentId}`}>
                              <Sparkles size={14} />{analyzeMutation.isPending ? 'Uruchamianie…' : 'Analizuj ofertę'}
                            </button>
                          )}
                          {isOfferResultDocument(document) && <Link href={projectAreaPath(projectId, purchaseAreaId, `documents/${document.documentId}`)} className="inline-flex h-9 items-center rounded-xl border border-border px-3 text-xs font-bold hover:bg-secondary" data-testid={`link-analysis-result-${document.documentId}`}>Zobacz wynik</Link>}
                        </div>
                      </div>
                      {documentTypeOf(document) === 'OFFER' && (document.analysisStatus === 'FAILED' || document.analysisStatus === 'RETRY_WAIT') && document.analysisError && <p className="mt-3 border-t border-border pt-3 text-xs text-destructive" data-testid={`text-analysis-error-${document.documentId}`}>{document.analysisError}</p>}
                    </div>
                  );
                })}
              </div>
            }
          </div>
          <aside className="space-y-3">
            <InfoCard icon={FileSearch} title="Odczyt oferty" detail="Po zakończeniu odczytu wynik pojawi się bezpośrednio na stronie dokumentu." />
            <InfoCard icon={CircleAlert} title="Sprawdzenie" detail="Status „Do sprawdzenia” oznacza, że dane wymagają weryfikacji przed decyzją zakupową." />
          </aside>
        </div>
        {analyzeMutation.isError && <p className="mt-4 text-sm text-destructive" role="alert">{mutationErrorMessage(analyzeMutation.error, 'Nie udało się uruchomić analizy.')}</p>}
        {purchaseAreaId && (
          <ProjectDocumentLibraryPicker
            open={libraryOpen}
            onClose={() => setLibraryOpen(false)}
            projectId={projectId}
            purchaseAreaId={purchaseAreaId}
            assignedDocuments={documents}
            onAssigned={() => documentsQuery.refetch().then(() => undefined)}
          />
        )}
        <DocumentUploadDialog
          open={Boolean(uploadDialogFiles)}
          files={uploadDialogFiles ?? []}
          projectId={projectId}
          purchaseAreaId={purchaseAreaId}
          onClose={() => setUploadDialogFiles(null)}
        />
      </div>
  );
}

function InfoCard({ icon: Icon, title, detail }: { icon: IconType; title: string; detail: string }) {
  return <div className="rounded-2xl border border-border bg-card/70 p-5"><Icon size={18} className="text-accent" /><p className="mt-4 text-sm font-bold">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></div>;
}

function StatusPill({ icon: Icon, label }: { icon: IconType; label: string }) {
  return <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground"><Icon size={15} />{label}<span className="ml-auto font-mono text-[10px]">—</span></div>;
}

function SourceEvidence({ refs, records, onSelect }: { refs?: Array<string | number> | null; records: AnalysisSourceRecord[]; onSelect?: (record: AnalysisSourceRecord) => void }) {
  if (!refs?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {refs.map((sourceRef) => {
        const record = records.find((item) => String(item.ref) === String(sourceRef));
        return (
          record && onSelect ? (
            <button type="button" key={String(sourceRef)} onClick={() => onSelect(record)} className="rounded-full border border-border bg-secondary/70 px-2.5 py-1 font-mono text-[10px] text-accent hover:border-primary">
              Źródło · str. {record.page == null ? '—' : textValue(record.page)}
            </button>
          ) : (
            <span key={String(sourceRef)} className="rounded-full border border-dashed border-border px-2.5 py-1 font-mono text-[10px] text-muted-foreground">Brak źródła</span>
          )
        );
      })}
    </div>
  );
}

function AnalysisResultView({ result }: { result: OfferAnalysisResult | null }) {
  const [itemSearch, setItemSearch] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedSource, setSelectedSource] = useState<AnalysisSourceRecord | null>(null);
  const offer = result?.offer;
  const checks = result?.checks;
  const sourceRecords = result?.sourceRecords ?? [];
  const items = offer?.items ?? [];
  const issues = listValue(offer?.issues);
  const checkIssues = listValue(checks?.issues);
  const terms = displayAnalysisTerms(offer?.terms);
  const filteredItems = useMemo(() => {
    const normalizedSearch = itemSearch.trim().toLocaleLowerCase('pl-PL');
    return items.filter((item) => {
      const matchesSearch = !normalizedSearch || [item.description, item.lineNo, item.unit].some((value) => displayAnalysisValue(value, '').toLocaleLowerCase('pl-PL').includes(normalizedSearch));
      const matchesIssues = !onlyIssues || Boolean(item.issues?.length);
      return matchesSearch && matchesIssues;
    });
  }, [itemSearch, items, onlyIssues]);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const visibleItems = filteredItems.slice(page * pageSize, (page + 1) * pageSize);

  if (!result) {
    return <div className="rounded-2xl border border-dashed border-border bg-card/60 p-6 text-center text-sm text-muted-foreground">Wynik analizy nie jest jeszcze dostępny.</div>;
  }

  function displayMoney(value: unknown) {
    if (value === null || value === undefined || value === '') return 'Brak danych';
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(numeric) : displayAnalysisValue(value);
  }

  const totals = offer?.totals ?? {};

  return (
    <section className="space-y-5" data-testid="analysis-result">
      <div className="rounded-2xl border border-border bg-card/70 p-5">
        <div className="flex items-center gap-2 border-b border-border pb-4"><Sparkles size={17} className="text-accent" /><h2 className="font-display font-bold">Oferta</h2></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Dostawca', offer?.supplier],
            ['Numer oferty', offer?.offerNumber],
            ['Data wystawienia', offer?.issueDate],
            ['Ważna do', offer?.validUntil],
          ].map(([label, value]) => <div key={label} className="rounded-xl bg-secondary/60 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold">{textValue(value)}</p></div>)}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ['Wartość netto', totals.net],
            ['VAT', totals.vat],
            ['Brutto', totals.gross],
          ].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-background p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-sm font-semibold">{displayMoney(value)}</p></div>)}
        </div>
        {issues.length > 0 && <IssueList title="Najważniejsze uwagi" issues={issues} />}
        {terms.length > 0 && <details className="mt-5 border-t border-border pt-4"><summary className="cursor-pointer text-sm font-bold">Warunki oferty <span className="ml-2 text-xs font-normal text-muted-foreground">({terms.length})</span></summary><ul className="mt-3 space-y-3">{terms.map((term, index) => <li key={`${term.text}-${index}`} className="text-sm leading-6"><p className="whitespace-pre-wrap">{term.text}</p><SourceEvidence refs={term.sourceRefs} records={sourceRecords} onSelect={setSelectedSource} /></li>)}</ul></details>}
      </div>

      <div className="rounded-2xl border border-border bg-card/70 p-5">
        <div className="flex items-center gap-2 border-b border-border pb-4"><CheckCircle2 size={17} className="text-accent" /><h2 className="font-display font-bold">Sprawdzenie oferty</h2></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-secondary/60 p-3"><p className="text-xs text-muted-foreground">Suma pozycji netto</p><p className="mt-1 font-mono text-sm font-semibold">{textValue(checks?.lineNetSum)}</p></div>
          <div className="rounded-xl bg-secondary/60 p-3"><p className="text-xs text-muted-foreground">Zgodność sum</p><p className="mt-1 text-sm font-semibold">{textValue(checks?.netMatches)}</p></div>
          <div className="rounded-xl bg-secondary/60 p-3"><p className="text-xs text-muted-foreground">Wymaga sprawdzenia</p><p className="mt-1 text-sm font-semibold">{textValue(checks?.reviewRequired)}</p></div>
        </div>
        {checks?.note && <p className="mt-4 text-sm leading-6 text-muted-foreground">{checks.note}</p>}
        {checkIssues.length > 0 && <IssueList title="Uwagi kontroli" issues={checkIssues} />}
      </div>

      <div className="rounded-2xl border border-border bg-card/70 p-5">
        <div className="flex flex-col justify-between gap-3 border-b border-border pb-4 md:flex-row md:items-center"><div className="flex items-center gap-2"><FileSearch size={17} className="text-accent" /><h2 className="font-display font-bold">Pozycje oferty</h2><span className="font-mono text-[10px] uppercase text-muted-foreground">{filteredItems.length} / {items.length}</span></div><div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="analysis-item-search">Szukaj pozycji</label><input id="analysis-item-search" value={itemSearch} onChange={(event) => { setItemSearch(event.target.value); setPage(0); }} placeholder="Szukaj pozycji" className="h-9 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary" /><label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs"><input type="checkbox" checked={onlyIssues} onChange={(event) => { setOnlyIssues(event.target.checked); setPage(0); }} className="accent-primary" /> Tylko z uwagami</label></div></div>
        {items.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">Brak pozycji w wyniku analizy.</p> : filteredItems.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">Nie znaleziono pozycji spełniających filtr.</p> : <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="px-3 py-3 font-medium">Lp.</th><th className="px-3 py-3 font-medium">Materiał</th><th className="px-3 py-3 text-right font-medium">Ilość</th><th className="px-3 py-3 font-medium">Jednostka</th><th className="px-3 py-3 text-right font-medium">Cena netto</th><th className="px-3 py-3 text-right font-medium">Wartość netto</th><th className="px-3 py-3 font-medium">Uwagi</th></tr></thead><tbody>{visibleItems.map((item, index) => <tr key={`${textValue(item.lineNo, String(index + page * pageSize + 1))}-${index}`} className="border-b border-border/70 align-top last:border-0"><td className="px-3 py-3 font-mono text-xs">{textValue(item.lineNo, String(index + page * pageSize + 1))}</td><td className="max-w-[260px] px-3 py-3">{textValue(item.description)}</td><td className="px-3 py-3 text-right font-mono text-xs">{textValue(item.quantity)}</td><td className="px-3 py-3">{textValue(item.unit)}</td><td className="px-3 py-3 text-right font-mono text-xs">{textValue(item.unitNet)}</td><td className="px-3 py-3 text-right font-mono text-xs">{textValue(item.lineNet)}</td><td className="min-w-[130px] px-3 py-3">{listValue(item.issues).length > 0 && <ul className="space-y-1 text-xs text-muted-foreground">{listValue(item.issues).map((issue, issueIndex) => <li key={`${issue}-${issueIndex}`}><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-accent" />{issue}</li>)}</ul>}<SourceEvidence refs={item.sourceRefs} records={sourceRecords} onSelect={setSelectedSource} /></td></tr>)}</tbody></table></div>}
        {pageCount > 1 && <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>Strona {page + 1} z {pageCount}</span><div className="flex gap-2"><button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40">Wstecz</button><button type="button" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page >= pageCount - 1} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40">Dalej</button></div></div>}
      </div>

      {selectedSource && <aside className="rounded-2xl border border-primary/30 bg-primary/5 p-5" aria-label="Źródło wyniku"><div className="flex items-start justify-between gap-3"><div><p className="font-display font-bold">Źródło</p><p className="mt-1 text-xs text-muted-foreground">Strona {selectedSource.page == null ? 'nieustalona' : textValue(selectedSource.page)}</p></div><button type="button" onClick={() => setSelectedSource(null)} className="rounded-lg p-1 text-muted-foreground hover:bg-secondary" aria-label="Zamknij źródło"><X size={16} /></button></div><p className="mt-4 whitespace-pre-wrap text-sm leading-6">{displaySourceRecordContent(selectedSource)}</p></aside>}
    </section>
  );
}

function IssueList({ title, issues }: { title: string; issues: string[] }) {
  return <div className="mt-5 border-t border-border pt-5"><p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{title}</p><ul className="mt-3 space-y-2 text-sm leading-6">{issues.map((issue, index) => <li key={`${issue}-${index}`} className="flex gap-2"><CircleAlert size={15} className="mt-1 shrink-0 text-accent" />{issue}</li>)}</ul></div>;
}

function DocumentsDetailPage() {
  const { projectId = 'nieznany', documentId = 'nieznany' } = useParams<{ projectId: string; documentId: string }>();
  const { purchaseAreaId } = useProjectArea();
  const documentsQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['documents', projectId], purchaseAreaId),
    queryFn: ({ signal }) => listDocuments(projectId, purchaseAreaId, signal),
    enabled: isApiConfigured() && isAuthConfigured(),
    retry: false,
    refetchInterval: (query) => analysisRefetchInterval(query.state.data),
  });
  const downloadMutation = useMutation({
    mutationFn: () => downloadDocument(projectId, documentId, purchaseAreaId),
  });
  const analyzeMutation = useMutation({
    mutationFn: () => analyzeDocument(projectId, documentId, purchaseAreaId),
    onSuccess: async () => {
      await documentsQuery.refetch();
    },
  });
  const analysisMutation = useMutation<AnalysisResponse>({
    mutationFn: () => getAnalysis(projectId, documentId, purchaseAreaId),
  });
  const document = documentsQuery.data?.find((item) => item.documentId === documentId);
  const showOfferResult = Boolean(document && isOfferResultDocument(document));
  const hasConfiguration = isApiConfigured() && isAuthConfigured();
  const analysisLoadedRef = useRef(false);

  useEffect(() => {
    if (showOfferResult && !analysisLoadedRef.current) {
      analysisLoadedRef.current = true;
      analysisMutation.mutate();
    }
    if (!showOfferResult) {
      analysisLoadedRef.current = false;
      analysisMutation.reset();
    }
  }, [showOfferResult]);

  function handleDownload() {
    downloadMutation.mutate(undefined, {
      onSuccess: (result) => {
        window.open(result.url, '_blank', 'noopener,noreferrer');
      },
    });
  }

  return (
      <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10">
         <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
           <Link href={projectAreaPath(projectId, purchaseAreaId, 'documents')} className="flex items-center gap-1 hover:text-foreground" data-testid="link-back-documents"><ArrowLeft size={14} /> Pliki</Link>
           <span aria-hidden="true">/</span>
           <Link href={projectAreaPath(projectId, purchaseAreaId, 'scope')} className="font-semibold text-accent hover:underline" data-testid="link-document-return-to-thread">Wróć do rozmowy</Link>
         </div>
        {!hasConfiguration ? <ConnectionState kind={isApiConfigured() ? 'unauthorized' : 'missing'} /> :
          documentsQuery.isPending ? <LoadingState label="Pobieranie dokumentu…" /> :
           documentsQuery.isError ? <ConnectionState kind={connectionKindForError(documentsQuery.error)} title="Nie udało się pobrać dokumentu" detail={connectionErrorDetail(documentsQuery.error, 'Spróbuj ponownie za chwilę.')} /> :
          !document ? <ConnectionState kind="empty" title="Dokument nie istnieje" detail="Backend nie zwrócił dokumentu o podanym identyfikatorze." action={false} /> :
          <>
            <SectionHeading
              eyebrow="02 / ŹRÓDŁO"
              title={document.filename}
              description={isOfferPdf(document) ? `Status: ${analysisStatusLabel(document.analysisStatus)}` : documentStatusLabel(document.status)}
              action={
                <div className="flex flex-wrap gap-2">
                  <div className="w-full sm:w-[190px]">
                    <DocumentTypeSelect projectId={projectId} purchaseAreaId={purchaseAreaId} document={document} />
                  </div>
                  {canStartOfferAnalysis(document) && <button type="button" onClick={() => analyzeMutation.mutate()} disabled={analyzeMutation.isPending} className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-analyze-document"><Sparkles size={16} />{analyzeMutation.isPending ? 'Uruchamianie…' : 'Analizuj ofertę'}</button>}
                  <button type="button" onClick={handleDownload} disabled={document.status !== 'UPLOADED' || downloadMutation.isPending} className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-download-document"><Download size={16} /> {downloadMutation.isPending ? 'Przygotowanie…' : 'Otwórz oryginał'}</button>
                </div>
              }
            />
            {isOfferPdf(document) && <div className="mt-5 flex flex-wrap items-center gap-3"><span className="text-xs text-muted-foreground">Status analizy:</span><AnalysisStatusBadge document={document} />{(document.analysisStatus === 'FAILED' || document.analysisStatus === 'RETRY_WAIT') && document.analysisError && <span className="text-xs text-destructive">{document.analysisError}</span>}</div>}
            <div className="mt-8 grid gap-5 xl:grid-cols-[1fr_1fr]">
               <div className="rounded-2xl border border-border bg-card/70 p-5"><div className="flex items-center gap-2 border-b border-border pb-4"><FileCheck2 size={17} className="text-accent" /><p className="text-sm font-bold">Oryginał dokumentu</p></div><div className="mt-5 flex items-center justify-between gap-4"><div><p className="text-sm font-semibold">{document.filename}</p><p className="mt-1 text-xs text-muted-foreground">Otwórz plik, aby sprawdzić dane źródłowe.</p></div><button type="button" onClick={handleDownload} disabled={document.status !== 'UPLOADED' || downloadMutation.isPending} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold disabled:opacity-50"><Download size={14} /> Otwórz</button></div></div>
               <details className="rounded-2xl border border-border bg-card/70 p-5"><summary className="cursor-pointer text-sm font-bold">Szczegóły dokumentu</summary><div className="mt-4 space-y-3 text-sm"><div className="flex items-center justify-between border-b border-border/70 py-2"><span className="text-muted-foreground">Rozmiar</span><span>{formatDocumentSize(document.size)}</span></div><div className="flex items-center justify-between border-b border-border/70 py-2"><span className="text-muted-foreground">Dodano</span><PolishDate value={document.createdAt} /></div><div className="flex items-center justify-between py-2"><span className="text-muted-foreground">Stan pliku</span><span>{documentStatusLabel(document.status)}</span></div></div></details>
            </div>
            {downloadMutation.isError && <p className="mt-4 text-sm text-destructive" role="alert">{mutationErrorMessage(downloadMutation.error, 'Nie udało się przygotować pobierania.')}</p>}
            {canAnalyzeOffer(document) && analyzeMutation.isError && <p className="mt-4 text-sm text-destructive" role="alert">{mutationErrorMessage(analyzeMutation.error, 'Nie udało się uruchomić analizy.')}</p>}
            {showOfferResult && analysisMutation.isError && <div className="mt-4 flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert"><p className="text-sm text-destructive">{analysisErrorMessage(analysisMutation.error)}</p><button type="button" onClick={() => analysisMutation.mutate()} className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-destructive/30 px-3 text-xs font-bold text-destructive hover:bg-destructive/10" data-testid="button-retry-analysis-result">Pobierz wynik ponownie</button></div>}
              {showOfferResult && analysisMutation.isPending && <div className="mt-8"><LoadingState label="Pobieranie zapisanego wyniku…" /></div>}
              {showOfferResult && analysisMutation.data && <div className="mt-8"><AnalysisResultView result={analysisMutation.data.result} /></div>}
          </>
        }
      </div>
  );
}

function ComparisonsPage() {
  const { projectId = 'nieznany' } = useParams<{ projectId: string; comparisonId: string }>();
  return <ProjectLayout><div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10"><div className="mb-7 flex items-center gap-2 text-xs text-muted-foreground"><Link href={`/projects/${projectId}/documents`} className="hover:text-foreground" data-testid="link-back-comparisons"><ArrowLeft size={14} /> Dokumenty</Link><ChevronRight size={13} /><span>Porównanie</span></div><SectionHeading eyebrow="03 / ZAKUP" title="Porównanie ofert" description="Jedno miejsce dla wspólnej listy materiałów, kosztów nierozstrzygniętych i założeń technicznych." action={<button type="button" disabled className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-bold opacity-50" data-testid="button-export-comparison"><Download size={16} /> Eksportuj</button>} /><div className="mt-8"><ConnectionState kind={isConfigured ? 'unauthorized' : 'missing'} title="Porównanie nie jest dostępne" detail="Wynik porównania pojawi się po prawidłowym pobraniu ofert." /></div><div className="mt-5 grid gap-3 md:grid-cols-4">{['Oryginalna suma', 'Wspólna lista materiałów', 'Transport', 'Koszty nierozstrzygnięte'].map((label) => <div key={label} className="rounded-2xl border border-border bg-card/70 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-4 font-display text-xl font-bold"><Pln value={null} /></p></div>)}</div><div className="mt-5 grid gap-5 lg:grid-cols-2"><ComparisonSection title="Pozycje wykluczone i brakujące" icon={CircleAlert} /><ComparisonSection title="Założenia i uwagi techniczne" icon={ClipboardCheck} /></div></div></ProjectLayout>;
}

function ComparisonsIndexPage() {
  return <ProjectLayout><ComparisonsHistoryPage /></ProjectLayout>;
}

function ComparisonSection({ title, icon: Icon }: { title: string; icon: IconType }) {
  return <section className="rounded-2xl border border-border bg-card/70 p-5"><div className="flex items-center gap-2"><Icon size={17} className="text-accent" /><h2 className="font-display font-bold">{title}</h2></div><div className="mt-6 rounded-xl bg-secondary/70 p-5 text-center text-sm text-muted-foreground">Brak danych z backendu. <span className="font-semibold text-foreground">Do ustalenia</span> nie oznacza zera.</div></section>;
}

function AssistantPage() {
  const { projectId = 'nieznany' } = useParams<{ projectId: string }>();
  return <ProjectLayout fillViewport><PurchaseThreadPage projectId={projectId} /></ProjectLayout>;
}

function UsersRoute() {
  return <AppShell adminOnly><UsersAdminPage /></AppShell>;
}

function InvoicesRoute() {
  return <AppShell><InvoiceListPage /></AppShell>;
}

function InvoiceDetailRoute() {
  const { invoiceId = '' } = useParams<{ invoiceId: string }>();
  return <AppShell><InvoiceDetailPage invoiceId={invoiceId} /></AppShell>;
}

function DocumentsDetailRoute() {
  return <AppShell><ProjectLayout><DocumentsDetailPage /></ProjectLayout></AppShell>;
}

function ComparisonsNewRoute() {
  return <AppShell><ProjectLayout><ComparisonsNewPage /></ProjectLayout></AppShell>;
}

function ComparisonDetailRoute() {
  return <AppShell><ProjectLayout><ComparisonDetailPage /></ProjectLayout></AppShell>;
}

function ScopeRoute() {
  return <AppShell><ScopePage /></AppShell>;
}

function ComparisonsIndexRoute() {
  return <AppShell><ProjectLayout><ComparisonsIndexPage /></ProjectLayout></AppShell>;
}

function DocumentsRoute() {
  return <AppShell><ProjectLayout><DocumentsPage /></ProjectLayout></AppShell>;
}

function AssistantRoute() {
  return <AppShell><AssistantPage /></AppShell>;
}

function ProjectEntryRedirect({ projectId }: { projectId: string }) {
  const [, setLocation] = useLocation();
  const session = useApiSession();
  const areasQuery = useQuery({
    queryKey: ['purchase-areas', projectId],
    queryFn: ({ signal }) => listPurchaseAreas(projectId, signal),
    enabled: Boolean(session.authUserId) && isApiConfigured() && isAuthConfigured(),
    retry: false,
    staleTime: 10_000,
    refetchOnMount: 'always',
  });
  const configured = isApiConfigured() && isAuthConfigured();

  useEffect(() => {
    if (!configured) {
      setLocation(projectAreaPath(projectId, null, 'scope'), { replace: true });
      return;
    }
    if (!session.authUserId || !areasQuery.isSuccess) return;
    const savedAreaId = getLastPurchaseAreaId(projectId);
    const savedArea = savedAreaId
      ? areasQuery.data.items.find((area) => !area.isGeneral && area.purchaseAreaId === savedAreaId)
      : undefined;
    const nextAreaId = savedArea?.purchaseAreaId ?? null;
    if (savedAreaId && !savedArea) rememberPurchaseArea(projectId, null);
    setLocation(projectAreaPath(projectId, nextAreaId, 'scope'), { replace: true });
  }, [areasQuery.data, areasQuery.isSuccess, configured, projectId, session.authUserId, setLocation]);

  if (!configured) return null;
  if (areasQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-xl p-5 sm:p-8">
        <ProjectAreaState
          title="Nie udało się odtworzyć ostatniego tematu"
          detail="Nie można sprawdzić, które tematy zakupów są dostępne. Spróbuj ponownie albo otwórz temat Ogólne."
          action={<div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void areasQuery.refetch()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold"><RefreshCw size={15} /> Spróbuj ponownie</button>
            <button type="button" onClick={() => setLocation(projectAreaPath(projectId, null, 'scope'), { replace: true })} className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground">Otwórz Ogólne</button>
          </div>}
        />
      </div>
    );
  }
  return <div className="grid min-h-0 flex-1 place-items-center p-5"><LoadingState label="Otwieranie rozmowy…" /></div>;
}

function ProjectRoute() {
  const { projectId = 'nieznany' } = useParams<{ projectId: string }>();
  return <AppShell><ProjectLayout fillViewport><ProjectEntryRedirect projectId={projectId} /></ProjectLayout></AppShell>;
}

function ProjectsRoute() {
  return <AppShell><ProjectsPage /></AppShell>;
}

function HelpRoute() {
  return <AppShell><HelpPage /></AppShell>;
}

function Router() {
  return <ErrorBoundary resetKey={window.location.pathname}><Switch>
    <Route path="/" component={Home} />
    <Route path="/auth/callback" component={AuthCallback} />
    <Route path="/users" component={UsersRoute} />
    <Route path="/faktury/:invoiceId" component={InvoiceDetailRoute} />
    <Route path="/faktury" component={InvoicesRoute} />
    <Route path="/help" component={HelpRoute} />
    <Route path="/projects/:projectId/purchases/:purchaseAreaId/documents/:documentId" component={DocumentsDetailRoute} />
    <Route path="/projects/:projectId/purchases/:purchaseAreaId/comparisons/new" component={ComparisonsNewRoute} />
    <Route path="/projects/:projectId/purchases/:purchaseAreaId/comparisons/:jobId" component={ComparisonDetailRoute} />
    <Route path="/projects/:projectId/purchases/:purchaseAreaId/scope" component={ScopeRoute} />
    <Route path="/projects/:projectId/purchases/:purchaseAreaId/comparisons" component={ComparisonsIndexRoute} />
    <Route path="/projects/:projectId/purchases/:purchaseAreaId/documents" component={DocumentsRoute} />
    <Route path="/projects/:projectId/purchases/:purchaseAreaId/assistant" component={AssistantRoute} />
    <Route path="/projects/:projectId/documents/:documentId" component={DocumentsDetailRoute} />
    <Route path="/projects/:projectId/comparisons/new" component={ComparisonsNewRoute} />
    <Route path="/projects/:projectId/comparisons/:jobId" component={ComparisonDetailRoute} />
    <Route path="/projects/:projectId/scope" component={ScopeRoute} />
    <Route path="/projects/:projectId/comparisons" component={ComparisonsIndexRoute} />
    <Route path="/projects/:projectId/documents" component={DocumentsRoute} />
    <Route path="/projects/:projectId/assistant" component={AssistantRoute} />
    <Route path="/projects/:projectId" component={ProjectRoute} />
    <Route path="/projects" component={ProjectsRoute} />
    <Route component={NotFound} />
  </Switch></ErrorBoundary>;
}

function ScopePage() {
  const { projectId = 'nieznany' } = useParams<{ projectId: string }>();
  return <ProjectLayout fillViewport><PurchaseThreadPage projectId={projectId} /></ProjectLayout>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><ApiSessionProvider><SessionExpiryHandler /><ApplicationRoutes /></ApiSessionProvider><Toaster /></WouterRouter></TooltipProvider></QueryClientProvider>;
}

function ApplicationRoutes() {
  const session = useApiSession();
  if (session.sessionEnding) return null;
  if (!session.accessDenied) return <Router />;
  return (
    <main className="sogo-noise grid min-h-[100dvh] place-items-center bg-background p-5">
      <section className="w-full max-w-lg rounded-2xl border border-destructive/20 bg-card p-6 text-center shadow-sm">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-destructive/10 text-destructive"><ShieldAlert size={22} /></div>
        <p className="mt-4 text-sm font-semibold" role="alert" data-testid="text-access-denied">{ACCESS_DENIED_MESSAGE}</p>
        <button
          type="button"
          onClick={() => void logout()}
          disabled={session.sessionEnding || !isAuthConfigured()}
          className="mt-5 inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-bold hover:bg-secondary"
          data-testid="button-logout-access-denied"
        >
          Wyloguj się
        </button>
      </section>
    </main>
  );
}

function SessionExpiryHandler() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => onSessionExpired(() => {
    queryClient.removeQueries({
      predicate: (query) => !['sogo-auth-session', 'sogo-api-me'].includes(String(query.queryKey[0])),
    });
    void queryClient.invalidateQueries({ queryKey: ['sogo-auth-session'] });
    navigate('/');
  }), [navigate, queryClient]);

  return null;
}

export default App;