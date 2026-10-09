import { useMemo, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Check,
  ChevronDown,
  CircleUserRound,
  LoaderCircle,
  MailPlus,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRoundCog,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import {
  getAdminUserProjects,
  grantAdminProject,
  inviteAdminUser,
  listAdminUsersPage,
  resendAdminInvitation,
  revokeAdminProject,
  setAdminUserAccess,
  setAdminUserName,
  type AdminUser,
  type ApiRole,
} from '@/lib/api';
import { ApiRequestError } from '@/lib/api-errors';
import { useApiSession } from '@/lib/app-session';
import { isApiConfigured } from '@/lib/config';
import {
  canManageUserDisplayName,
  validateUserDisplayName,
} from '@/lib/author-display';

type InviteFormValues = { email: string };
type AccessChange = { role: ApiRole; enabled: boolean };
type ProjectChange = { projectId: string; assigned: boolean };

function accountStatus(user: AdminUser) {
  if (!user.configured) return 'Bez dostępu do SOGO';
  if (!user.enabled) return 'Dostęp zablokowany';
  if (!user.cognitoEnabled) return 'Logowanie zablokowane w AWS';
  if (user.loginStatus === 'FORCE_CHANGE_PASSWORD') return 'Oczekuje pierwszego logowania';
  return 'Aktywny';
}

function accountStatusTone(user: AdminUser) {
  if (!user.configured || !user.enabled || !user.cognitoEnabled) return 'border-destructive/20 bg-destructive/10 text-destructive';
  if (user.loginStatus === 'FORCE_CHANGE_PASSWORD') return 'border-primary/20 bg-primary/10 text-foreground';
  return 'border-accent/20 bg-accent/10 text-foreground';
}

function roleLabel(role: ApiRole) {
  return role === 'ADMIN' ? 'Administrator' : 'Użytkownik';
}

function errorText(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) return error.message || fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function invitationFailureText(error: unknown) {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
    return error.message || 'Backend odrzucił zaproszenie.';
  }
  return 'Nie można potwierdzić wyniku. Operacja nie została ponowiona automatycznie. Odśwież listę kont przed kolejną próbą.';
}

function Notice({ children, tone = 'info' }: { children: string; tone?: 'info' | 'success' | 'error' }) {
  const colors = {
    info: 'border-primary/20 bg-primary/5 text-foreground',
    success: 'border-accent/25 bg-accent/10 text-foreground',
    error: 'border-destructive/25 bg-destructive/10 text-destructive',
  }[tone];
  const Icon = tone === 'success' ? Check : AlertCircle;
  return (
    <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm leading-5 ${colors}`} role={tone === 'error' ? 'alert' : 'status'} data-testid={`notice-${tone}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function UsersAdminPage() {
  const queryClient = useQueryClient();
  const session = useApiSession();
  const [search, setSearch] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [manageUserId, setManageUserId] = useState<string | null>(null);
  const [roleConfirmation, setRoleConfirmation] = useState<ApiRole | null>(null);
  const [userNameEditOpen, setUserNameEditOpen] = useState(false);
  const [userNameDraft, setUserNameDraft] = useState('');
  const [userNameError, setUserNameError] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [manageNotice, setManageNotice] = useState<{ userId: string; text: string; tone: 'info' | 'success' } | null>(null);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectError, setProjectError] = useState<{ projectId: string; text: string } | null>(null);

  const usersQuery = useInfiniteQuery({
    queryKey: ['admin-users'],
    queryFn: ({ pageParam, signal }) => listAdminUsersPage(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: isApiConfigured() && session.user?.role === 'ADMIN',
    retry: false,
  });

  const users = useMemo(() => usersQuery.data?.pages.flatMap((page) => page.items) ?? [], [usersQuery.data]);
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pl-PL');
    if (!query) return users;
    return users.filter((user) =>
      `${user.name ?? ''} ${user.email}`.toLocaleLowerCase('pl-PL').includes(query),
    );
  }, [search, users]);

  const userProjectsQuery = useQuery({
    queryKey: ['admin-user-projects', manageUserId],
    queryFn: () => getAdminUserProjects(manageUserId!),
    enabled: Boolean(manageUserId) && session.user?.role === 'ADMIN',
    retry: false,
  });

  const inviteForm = useForm<InviteFormValues>({
    defaultValues: { email: '' },
    mode: 'onSubmit',
  });

  async function refreshUserData(userId = manageUserId) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
      userId
        ? queryClient.invalidateQueries({ queryKey: ['admin-user-projects', userId] })
        : Promise.resolve(),
    ]);
  }

  const inviteMutation = useMutation({
    mutationFn: (email: string) => inviteAdminUser(email),
    retry: false,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setInviteError('');
      inviteForm.reset({ email: '' });
      setInviteOpen(false);
      setManageUserId(result.user.userId);
      if (result.alreadyExists) {
        setManageNotice({
          userId: result.user.userId,
          tone: 'info',
          text: 'To konto już istnieje. Nie wysłano nowego zaproszenia ani nie zmieniono jego dostępu.',
        });
      } else if (result.invitationSent) {
        setManageNotice({
          userId: result.user.userId,
          tone: 'success',
          text: 'Zaproszenie zostało zlecone. Teraz przypisz projekty.',
        });
      } else {
        setManageNotice({
          userId: result.user.userId,
          tone: 'info',
          text: 'Konto zostało utworzone, ale backend nie potwierdził zlecenia wiadomości startowej. Teraz przypisz projekty.',
        });
      }
    },
    onError: async (error) => {
      setInviteError(invitationFailureText(error));
      await usersQuery.refetch();
    },
  });

  const accessMutation = useMutation({
    mutationFn: ({ role, enabled }: AccessChange) => {
      const currentUser = userProjectsQuery.data?.user;
      if (!currentUser) throw new Error('Najpierw pobierz aktualne dane konta.');
      return setAdminUserAccess(currentUser.userId, role, enabled);
    },
    retry: false,
    onSuccess: async () => {
      await refreshUserData();
    },
    onError: async () => {
      await refreshUserData();
    },
  });

  const userNameMutation = useMutation({
    mutationFn: ({ userId, name }: { userId: string; name: string }) => {
      if (!canManageUserDisplayName(session.user?.role)) {
        throw new Error('Tylko administrator może zmienić imię i nazwisko użytkownika.');
      }
      const validation = validateUserDisplayName(name);
      if (validation.error) throw new Error(validation.error);
      return setAdminUserName(userId, validation.name);
    },
    retry: false,
    onSuccess: async ({ userId }) => {
      setUserNameEditOpen(false);
      setUserNameError('');
      setManageNotice({
        userId,
        tone: 'success',
        text: 'Zapisano imię i nazwisko.',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-user-projects', userId] }),
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['purchase-areas'] }),
        queryClient.invalidateQueries({ queryKey: ['purchase-area'] }),
      ]);
    },
  });

  const resendMutation = useMutation({
    mutationFn: (userId: string) => resendAdminInvitation(userId),
    retry: false,
    onSuccess: async () => {
      if (manageUserId) {
        setManageNotice({
          userId: manageUserId,
          tone: 'success',
          text: 'Zlecono ponowne wysłanie instrukcji. Nie oznacza to potwierdzenia doręczenia wiadomości.',
        });
      }
      await refreshUserData();
    },
    onError: async () => {
      await refreshUserData();
    },
  });

  const projectMutation = useMutation({
    mutationFn: ({ projectId, assigned }: ProjectChange) => {
      if (!manageUserId) throw new Error('Nie wybrano konta.');
      return assigned
        ? grantAdminProject(manageUserId, projectId)
        : revokeAdminProject(manageUserId, projectId);
    },
    retry: false,
    onMutate: ({ projectId }) => {
      setProjectError((current) => current?.projectId === projectId ? null : current);
    },
    onSuccess: async () => {
      await refreshUserData();
    },
    onError: async (error, variables) => {
      setProjectError({
        projectId: variables.projectId,
        text: errorText(error, 'Nie udało się zmienić przypisania.'),
      });
      await refreshUserData();
    },
  });

  const selectedUser = userProjectsQuery.data?.user ?? users.find((user) => user.userId === manageUserId);
  const selectedDetailsLoaded = Boolean(userProjectsQuery.data?.user);
  const assignedProjects = userProjectsQuery.data?.items.filter((project) => project.assigned) ?? [];
  const currentUserIsTarget = selectedUser?.userId === session.user?.userId;
  const accountProtected = Boolean(selectedUser?.isPrimaryAdmin || currentUserIsTarget);
  const roleChangeDisabled = !selectedDetailsLoaded || accountProtected || accessMutation.isPending;
  const filteredProjects = (userProjectsQuery.data?.items ?? []).filter((project) =>
    project.name.toLocaleLowerCase('pl-PL').includes(projectSearch.trim().toLocaleLowerCase('pl-PL')),
  );

  function requestRoleChange(role: ApiRole) {
    const currentUser = userProjectsQuery.data?.user;
    if (!currentUser || role === currentUser.role || roleChangeDisabled) return;
    if (currentUser.role === 'ADMIN' && role === 'USER') {
      setRoleConfirmation(role);
      return;
    }
    accessMutation.mutate({ role, enabled: currentUser.enabled });
  }

  function confirmRoleChange() {
    const currentUser = userProjectsQuery.data?.user;
    if (!currentUser || !roleConfirmation) return;
    accessMutation.mutate({ role: roleConfirmation, enabled: currentUser.enabled });
    setRoleConfirmation(null);
  }

  function submitInvite(values: InviteFormValues) {
    setInviteError('');
    inviteMutation.mutate(values.email.trim());
  }

  function openUserNameEditor(user: AdminUser) {
    if (!canManageUserDisplayName(session.user?.role)) return;
    userNameMutation.reset();
    setUserNameError('');
    setUserNameDraft(user.name?.trim() ?? '');
    setUserNameEditOpen(true);
  }

  function submitUserName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser || !canManageUserDisplayName(session.user?.role)) return;
    const validation = validateUserDisplayName(userNameDraft);
    setUserNameError(validation.error);
    if (validation.error) return;
    userNameMutation.mutate({ userId: selectedUser.userId, name: validation.name });
  }

  if (!isApiConfigured()) {
    return (
      <main className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10">
        <div className="rounded-2xl border border-border bg-card/70 p-6 text-sm text-muted-foreground">
          Panel użytkowników wymaga skonfigurowanego połączenia z API.
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10">
      <header className="flex flex-col justify-between gap-5 border-b border-border pb-7 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-accent">03 / DOSTĘP</p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.045em] md:text-[40px]" data-testid="heading-users">Użytkownicy</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Zarządzaj kontami i przypisaniem do projektów. Zmiany dostępu są zapisywane od razu.</p>
        </div>
        <button
          type="button"
          onClick={() => { setInviteError(''); setInviteOpen(true); }}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:brightness-105"
          data-testid="button-invite-user"
        >
          <MailPlus size={16} /> Zaproś użytkownika
        </button>
      </header>

      <section className="mt-6 rounded-2xl border border-border bg-card/70 p-4 md:p-5" aria-label="Lista użytkowników">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block w-full max-w-xl">
            <Search size={16} className="absolute left-3.5 top-3.5 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Szukaj w załadowanych kontach"
              className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
              data-testid="input-search-users"
            />
          </label>
          <div className="text-xs text-muted-foreground" data-testid="text-loaded-users-count">
            {users.length} {users.length === 1 ? 'konto' : 'kont'} załadowano
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Wyszukiwanie obejmuje tylko pobrane strony katalogu.</p>

        {usersQuery.isPending ? (
          <div className="mt-5 flex items-center gap-2 rounded-xl bg-background/70 p-5 text-sm text-muted-foreground" role="status">
            <LoaderCircle size={16} className="animate-spin" /> Pobieranie kont…
          </div>
        ) : usersQuery.isError ? (
          <div className="mt-5 rounded-xl border border-destructive/20 bg-destructive/5 p-4" role="alert">
            <p className="text-sm font-semibold">Nie udało się pobrać użytkowników.</p>
            <p className="mt-1 text-sm text-muted-foreground">{errorText(usersQuery.error, 'Spróbuj ponownie za chwilę.')}</p>
            <button type="button" onClick={() => void usersQuery.refetch()} className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-bold" data-testid="button-retry-users">
              <RefreshCw size={14} /> Spróbuj ponownie
            </button>
          </div>
        ) : users.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-border p-8 text-center">
            <CircleUserRound size={24} className="mx-auto text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">Brak kont do wyświetlenia</p>
            <p className="mt-1 text-sm text-muted-foreground">Gdy konta będą dostępne, pojawią się na tej liście.</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-border p-8 text-center" data-testid="state-users-no-matches">
            <p className="text-sm font-semibold">Brak dopasowań w załadowanych kontach</p>
            <p className="mt-1 text-sm text-muted-foreground">Wczytaj kolejną stronę, aby sprawdzić następne konta katalogu.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-2" data-testid="list-users">
            {filteredUsers.map((user) => (
              <article key={user.userId} className="flex flex-col gap-4 rounded-xl border border-border bg-background/65 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-user-${user.userId}`}>
                <div className="flex min-w-0 items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-accent">
                    {user.role === 'ADMIN' ? <ShieldCheck size={18} /> : <CircleUserRound size={18} />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold" data-testid={`text-user-name-${user.userId}`}>{user.name?.trim() || user.email}</p>
                      {user.isPrimaryAdmin && <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-foreground">Główny administrator</span>}
                    </div>
                    {user.name?.trim() && <p className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</p>}
                    <p className="mt-2 text-xs text-muted-foreground" data-testid={`last-login-${user.userId}`}>
                      Ostatnie logowanie: {user.lastLoginAt && !Number.isNaN(Date.parse(user.lastLoginAt))
                        ? <time dateTime={user.lastLoginAt}>{new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(user.lastLoginAt))} (czas polski)</time>
                        : 'Brak danych o logowaniu'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold text-foreground">{roleLabel(user.role)}</span>
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${accountStatusTone(user)}`} data-testid={`status-user-${user.userId}`}>
                        {accountStatus(user)}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setManageUserId(user.userId); setProjectSearch(''); setProjectError(null); }}
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-bold hover:bg-secondary"
                  data-testid={`button-manage-user-${user.userId}`}
                >
                  <UserRoundCog size={15} /> Zarządzaj
                </button>
              </article>
            ))}
          </div>
        )}

        {usersQuery.hasNextPage && (
          <button
            type="button"
            onClick={() => void usersQuery.fetchNextPage()}
            disabled={usersQuery.isFetchingNextPage}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background text-sm font-bold hover:bg-secondary disabled:opacity-50 sm:w-auto sm:px-4"
            data-testid="button-load-more-users"
          >
            {usersQuery.isFetchingNextPage ? <LoaderCircle size={15} className="animate-spin" /> : <ChevronDown size={15} />}
            {usersQuery.isFetchingNextPage ? 'Wczytywanie…' : 'Wczytaj więcej'}
          </button>
        )}
      </section>

      <Dialog open={inviteOpen} onOpenChange={(open) => {
        if (!open && !inviteMutation.isPending) {
          setInviteOpen(false);
          setInviteError('');
          inviteForm.reset({ email: '' });
        } else if (open) {
          setInviteOpen(true);
        }
      }}>
        <DialogContent className="w-[calc(100%-1.5rem)] max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Zaproś użytkownika</DialogTitle>
            <DialogDescription>Podaj adres e-mail. Nowe konto otrzyma rolę Użytkownik i nie dostanie automatycznie żadnego projektu.</DialogDescription>
          </DialogHeader>
          <Form {...inviteForm}>
            <form onSubmit={inviteForm.handleSubmit(submitInvite)} className="space-y-4" data-testid="form-invite-user">
              <FormField
                control={inviteForm.control}
                name="email"
                rules={{
                  required: 'Podaj adres e-mail.',
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Podaj poprawny adres e-mail.' },
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Adres e-mail</FormLabel>
                    <FormControl>
                      <input
                        {...field}
                        type="email"
                        autoComplete="email"
                        maxLength={254}
                        placeholder="osoba@firma.pl"
                        disabled={inviteMutation.isPending}
                        className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                        data-testid="input-invite-email"
                      />
                    </FormControl>
                    <FormDescription>Wiadomość startowa nie jest potwierdzeniem doręczenia.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {inviteError && <Notice tone="error">{inviteError}</Notice>}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setInviteOpen(false)} disabled={inviteMutation.isPending} className="h-10 rounded-xl border border-border px-4 text-sm font-semibold disabled:opacity-50" data-testid="button-cancel-invite">Anuluj</button>
                <button type="submit" disabled={inviteMutation.isPending} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50" data-testid="button-submit-invite">
                  {inviteMutation.isPending && <LoaderCircle size={15} className="animate-spin" />}
                  {inviteMutation.isPending ? 'Zlecanie…' : 'Wyślij zaproszenie'}
                </button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(manageUserId)} onOpenChange={(open) => {
        if (!open) {
          setManageUserId(null);
          setRoleConfirmation(null);
          setUserNameEditOpen(false);
          setUserNameError('');
          accessMutation.reset();
          userNameMutation.reset();
          resendMutation.reset();
          projectMutation.reset();
        }
      }}>
        <DialogContent className="w-[calc(100%-1.25rem)] max-w-3xl rounded-2xl p-4 sm:p-6">
          <DialogHeader className="pr-7">
            <DialogTitle className="font-display text-xl">Zarządzaj kontem</DialogTitle>
            <DialogDescription>Zmiany roli, blokady i przypisań są wysyłane do API osobno.</DialogDescription>
          </DialogHeader>

          {userProjectsQuery.isPending ? (
            <div className="flex items-center gap-2 rounded-xl bg-secondary/60 p-5 text-sm text-muted-foreground" role="status">
              <LoaderCircle size={16} className="animate-spin" /> Pobieranie konta i projektów…
            </div>
          ) : userProjectsQuery.isError ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4" role="alert">
              <p className="text-sm font-semibold">Nie udało się pobrać danych konta.</p>
              <p className="mt-1 text-sm text-muted-foreground">{errorText(userProjectsQuery.error, 'Spróbuj ponownie.')}</p>
              <button type="button" onClick={() => void userProjectsQuery.refetch()} className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-bold" data-testid="button-retry-user-details">
                <RefreshCw size={14} /> Spróbuj ponownie
              </button>
            </div>
          ) : selectedUser && userProjectsQuery.data ? (
            <div className="space-y-5">
              {manageNotice?.userId === selectedUser.userId && <Notice tone={manageNotice.tone}>{manageNotice.text}</Notice>}

              <section className="rounded-xl border border-border bg-card/70 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-all text-base font-bold" data-testid="text-managed-user-email">{selectedUser.email}</p>
                    {selectedUser.name?.trim() && <p className="mt-1 text-sm text-muted-foreground">{selectedUser.name}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold">{roleLabel(selectedUser.role)}</span>
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${accountStatusTone(selectedUser)}`}>{accountStatus(selectedUser)}</span>
                      {selectedUser.isPrimaryAdmin && <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-bold">Główny administrator</span>}
                    </div>
                  </div>
                  {selectedUser.isPrimaryAdmin && <ShieldCheck size={20} className="shrink-0 text-primary" aria-hidden="true" />}
                </div>
                {canManageUserDisplayName(session.user?.role) && (
                  <div className="mt-4 border-t border-border pt-4">
                    {!userNameEditOpen ? (
                      <button
                        type="button"
                        onClick={() => openUserNameEditor(selectedUser)}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold hover:bg-secondary"
                        data-testid="button-edit-user-name"
                      >
                        <Pencil size={14} /> Zmień imię i nazwisko
                      </button>
                    ) : (
                      <form onSubmit={submitUserName} className="space-y-3" data-testid="form-edit-user-name">
                        <div>
                          <label htmlFor="input-user-display-name" className="mb-1.5 block text-xs font-semibold text-muted-foreground">Imię i nazwisko</label>
                          <input
                            id="input-user-display-name"
                            value={userNameDraft}
                            onChange={(event) => {
                              setUserNameDraft(event.target.value);
                              setUserNameError('');
                              userNameMutation.reset();
                            }}
                            maxLength={160}
                            autoComplete="name"
                            autoFocus
                            disabled={userNameMutation.isPending}
                            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                            data-testid="input-user-display-name"
                          />
                          {userNameError && <p className="mt-1 text-xs text-destructive" role="alert">{userNameError}</p>}
                        </div>
                        {userNameMutation.isError && <Notice tone="error">{errorText(userNameMutation.error, 'Nie udało się zmienić imienia i nazwiska.')}</Notice>}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="submit"
                            disabled={userNameMutation.isPending}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-50"
                            data-testid="button-save-user-name"
                          >
                            {userNameMutation.isPending && <LoaderCircle size={14} className="animate-spin" />}
                            {userNameMutation.isPending ? 'Zapisywanie…' : 'Zapisz'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setUserNameEditOpen(false);
                              setUserNameError('');
                              userNameMutation.reset();
                            }}
                            disabled={userNameMutation.isPending}
                            className="h-9 rounded-lg border border-border px-3 text-xs font-semibold disabled:opacity-50"
                            data-testid="button-cancel-user-name"
                          >
                            Anuluj
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </section>

              {accessMutation.isError && <Notice tone="error">{errorText(accessMutation.error, 'Nie udało się zmienić dostępu.')}</Notice>}
              {resendMutation.isError && <Notice tone="error">{errorText(resendMutation.error, 'Nie udało się zlecić ponownego zaproszenia.')}</Notice>}

              <section className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-border p-4">
                  <h3 className="text-sm font-bold">Rola</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Administrator ma dostęp do wszystkich projektów. Użytkownik widzi wyłącznie przypisane projekty.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {(['USER', 'ADMIN'] as const).map((role) => (
                      <button
                        key={role}
                        type="button"
                        onClick={() => requestRoleChange(role)}
                        disabled={roleChangeDisabled || selectedUser.role === role}
                        className={`min-h-10 rounded-lg border px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50 ${selectedUser.role === role ? 'border-primary/30 bg-primary/10 text-foreground' : 'border-border bg-background hover:bg-secondary'}`}
                        data-testid={`button-set-role-${role.toLowerCase()}`}
                      >
                        {roleLabel(role)}
                      </button>
                    ))}
                  </div>
                  {accountProtected && <p className="mt-2 text-xs text-muted-foreground">{selectedUser.isPrimaryAdmin ? 'Rola i blokada głównego administratora są zablokowane.' : 'Nie można zmienić roli ani zablokować własnego konta.'}</p>}
                </div>

                <div className="rounded-xl border border-border p-4">
                  <h3 className="text-sm font-bold">Dostęp do konta</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Blokada nie usuwa konta ani jego dokumentów.</p>
                  <button
                    type="button"
                    onClick={() => accessMutation.mutate({ role: selectedUser.role, enabled: !selectedUser.enabled })}
                    disabled={!selectedDetailsLoaded || accessMutation.isPending || accountProtected}
                    className={`mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50 ${selectedUser.enabled ? 'border-destructive/25 bg-destructive/5 text-destructive hover:bg-destructive/10' : 'border-accent/25 bg-accent/10 text-foreground hover:bg-accent/15'}`}
                    data-testid="button-toggle-user-access"
                  >
                    {accessMutation.isPending && <LoaderCircle size={14} className="animate-spin" />}
                    {selectedUser.enabled ? 'Zablokuj dostęp' : 'Odblokuj dostęp'}
                  </button>
                  {accountProtected && <p className="mt-2 text-xs text-muted-foreground">Nie można zablokować własnego konta ani głównego administratora.</p>}
                </div>
              </section>

              {selectedUser.role === 'ADMIN' ? (
                <section className="rounded-xl border border-primary/20 bg-primary/5 p-4" data-testid="text-admin-all-projects">
                  <div className="flex items-start gap-2">
                    <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-bold">Dostęp do wszystkich projektów</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">Przypisania nie ograniczają administratora. Po zmianie roli na Użytkownik pozostaną tylko projekty pokazane jako przypisane poniżej.</p>
                    </div>
                  </div>
                </section>
              ) : null}

              {selectedUser.configured && selectedUser.enabled && selectedUser.cognitoEnabled && selectedUser.loginStatus === 'FORCE_CHANGE_PASSWORD' && (
                <section className="rounded-xl border border-border p-4">
                  <h3 className="text-sm font-bold">Pierwsze logowanie</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Możesz jawnie zlecić ponowne wysłanie instrukcji. Nie zmienia to roli ani przypisań.</p>
                  <button
                    type="button"
                    onClick={() => resendMutation.mutate(selectedUser.userId)}
                    disabled={resendMutation.isPending}
                    className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold hover:bg-secondary disabled:opacity-50"
                    data-testid="button-resend-invitation"
                  >
                    {resendMutation.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <MailPlus size={14} />}
                    {resendMutation.isPending ? 'Wysyłanie…' : 'Wyślij zaproszenie ponownie'}
                  </button>
                </section>
              )}

              <section className="rounded-xl border border-border p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="text-sm font-bold">Projekty</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {selectedUser.role === 'ADMIN'
                        ? `Administrator ma dostęp do wszystkich projektów. ${assignedProjects.length} jawne przypisania zapisane.`
                        : selectedUser.enabled
                          ? 'Każda zmiana jest zapisywana osobno.'
                          : 'Aby przydzielić nowy projekt, najpierw odblokuj konto.'}
                    </p>
                  </div>
                  <label className="relative block w-full sm:max-w-xs">
                    <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
                    <input
                      type="search"
                      value={projectSearch}
                      onChange={(event) => setProjectSearch(event.target.value)}
                      placeholder="Szukaj projektu"
                      className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-xs outline-none focus:border-primary"
                      data-testid="input-search-user-projects"
                    />
                  </label>
                </div>
                {projectMutation.isError && projectError && (
                  <div className="mt-3">
                    <Notice tone="error">{projectError.text}</Notice>
                  </div>
                )}
                <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
                  {filteredProjects.length === 0 ? (
                    <p className="rounded-lg bg-background/70 p-4 text-center text-xs text-muted-foreground">
                      {userProjectsQuery.data.items.length === 0 ? 'Brak projektów do przypisania.' : 'Nie znaleziono projektu.'}
                    </p>
                  ) : filteredProjects.map((project) => {
                    const rowPending = projectMutation.isPending && projectMutation.variables?.projectId === project.projectId;
                    const cannotGrantWhileDisabled = !selectedUser.enabled && !project.assigned;
                    return (
                      <div key={project.projectId} className="flex items-center justify-between gap-3 rounded-lg bg-background/70 px-3 py-2.5" data-testid={`row-user-project-${project.projectId}`}>
                        <span className="min-w-0 truncate text-sm font-medium">{project.name}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          {rowPending && <LoaderCircle size={14} className="animate-spin text-muted-foreground" aria-label="Zapisywanie" />}
                          {selectedUser.role === 'ADMIN' ? (
                            <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold">{project.assigned ? 'Przypisany' : 'Brak jawnego przypisania'}</span>
                          ) : (
                            <Switch
                              checked={project.assigned}
                              onCheckedChange={(assigned) => projectMutation.mutate({ projectId: project.projectId, assigned })}
                              disabled={projectMutation.isPending || cannotGrantWhileDisabled}
                              aria-label={`${project.assigned ? 'Odbierz' : 'Przydziel'} projekt ${project.name}`}
                              data-testid={`switch-project-${project.projectId}`}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(roleConfirmation)} onOpenChange={(open) => !open && setRoleConfirmation(null)}>
        <DialogContent className="w-[calc(100%-1.5rem)] max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Zmiana administratora na użytkownika</DialogTitle>
            <DialogDescription>Po zmianie dostęp do projektów będzie wynikał wyłącznie z przypisań poniżej.</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-border bg-secondary/40 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Faktyczne przypisania</p>
            {assignedProjects.length ? (
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
                {assignedProjects.map((project) => <li key={project.projectId}>{project.name}</li>)}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Brak przypisanych projektów.</p>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setRoleConfirmation(null)} className="h-10 rounded-xl border border-border px-4 text-sm font-semibold" data-testid="button-cancel-role-change">Anuluj</button>
            <button type="button" onClick={confirmRoleChange} disabled={accessMutation.isPending} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50" data-testid="button-confirm-role-change">
              {accessMutation.isPending && <LoaderCircle size={14} className="animate-spin" />}
              Zmień rolę
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
