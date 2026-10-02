import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { ToastProvider, LoadingBlock, ErrorBlock } from './components/ui/feedback';
import { AppShell } from './layout/AppShell';
import { I18nProvider, storedLocale, type FormatOptions } from './i18n';
import { onUnauthorized } from './lib/api';
import { useAuthStatus, useSettings } from './lib/hooks';
import { WorkspaceProvider } from './lib/workspace';
import { LoginPage } from './features/auth/LoginPage';
import { SetupPage } from './features/auth/SetupPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DocumentsPage } from './features/documents/DocumentsPage';
import { DocumentDetailPage } from './features/documents/DocumentDetailPage';
import { SearchPage } from './features/search/SearchPage';
import { ActivityPage } from './features/activity/ActivityPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { WorkspacePage } from './features/workspaces/WorkspacePage';
import { SettingsPage } from './features/settings/SettingsPage';
import { PwaUpdater } from './layout/PwaUpdater';
import { FinanceOverviewPage } from './features/finance/FinanceOverviewPage';
import { TransactionsPage } from './features/finance/TransactionsPage';
import { AccountDetailPage, AccountsPage } from './features/finance/AccountsPage';
import { BudgetDetailPage, BudgetsPage } from './features/finance/BudgetsPage';
import { RecurringPage } from './features/finance/RecurringPage';
import { InstallmentDetailPage, InstallmentsPage } from './features/finance/InstallmentsPage';
import { DebtsPage } from './features/finance/DebtsPage';
import { GoalDetailPage, GoalsPage } from './features/finance/GoalsPage';
import { CategoriesPage } from './features/finance/CategoriesPage';
import { CurrenciesPage } from './features/finance/CurrenciesPage';
import { TodayPage } from './features/life/TodayPage';
import { TasksPage } from './features/life/TasksPage';
import { CalendarPage } from './features/life/CalendarPage';
import { GoalDetailOkrPage, GoalsOkrPage } from './features/life/GoalsOkrPage';
import { NotesPage } from './features/life/NotesPage';
import { PeoplePage, PersonDetailPage } from './features/life/PeoplePage';
import { PipelinePage } from './features/business/PipelinePage';
import { ProjectDetailPage, ProjectsPage } from './features/business/ProjectsPage';
import { CompaniesPage, CompanyDetailPage } from './features/business/CompaniesPage';
import { CareerOverviewPage } from './features/career/CareerOverviewPage';
import { ApplicationsPage } from './features/career/ApplicationsPage';
import { JobDetailPage, JobsPage } from './features/career/JobsPage';
import { AchievementsPage } from './features/career/AchievementsPage';
import { LearningPage, SkillsPage } from './features/career/SkillsLearningPage';

const DEFAULT_FORMAT: Omit<FormatOptions, 'locale'> = {
  digits: 'latn',
  dateFormat: 'dd/MM/yyyy',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Cairo',
  baseCurrency: 'EGP',
};

function useTheme(theme: 'system' | 'light' | 'dark') {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e1116' : '#f6f7f9');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function Public({ children }: { children: ReactNode }) {
  useTheme('system');
  return (
    <I18nProvider options={{ locale: storedLocale(), ...DEFAULT_FORMAT }}>
      <ToastProvider>{children}</ToastProvider>
    </I18nProvider>
  );
}

function Private() {
  const settings = useSettings();
  useTheme(settings.data?.theme ?? 'system');
  if (settings.isLoading) return null;
  const s = settings.data;
  const options: FormatOptions = s
    ? { locale: s.locale, digits: s.digits, dateFormat: s.dateFormat, timezone: s.timezone, baseCurrency: s.baseCurrency }
    : { locale: storedLocale(), ...DEFAULT_FORMAT };
  return (
    <I18nProvider options={options}>
      <ToastProvider>
        <WorkspaceProvider>
          <PwaUpdater />
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="documents" element={<DocumentsPage />} />
              <Route path="documents/:id" element={<DocumentDetailPage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="workspaces/:id" element={<WorkspacePage />} />
              <Route path="settings/*" element={<SettingsPage />} />
              <Route path="today" element={<TodayPage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="goals" element={<GoalsOkrPage />} />
              <Route path="goals/:id" element={<GoalDetailOkrPage />} />
              <Route path="notes" element={<NotesPage />} />
              <Route path="notes/:id" element={<NotesPage />} />
              <Route path="people" element={<PeoplePage />} />
              <Route path="people/:id" element={<PersonDetailPage />} />
              <Route path="pipeline" element={<PipelinePage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/:id" element={<ProjectDetailPage />} />
              <Route path="companies" element={<CompaniesPage />} />
              <Route path="companies/:id" element={<CompanyDetailPage />} />
              <Route path="career" element={<CareerOverviewPage />} />
              <Route path="career/applications" element={<ApplicationsPage />} />
              <Route path="career/jobs" element={<JobsPage />} />
              <Route path="career/jobs/:id" element={<JobDetailPage />} />
              <Route path="career/achievements" element={<AchievementsPage />} />
              <Route path="career/skills" element={<SkillsPage />} />
              <Route path="career/learning" element={<LearningPage />} />
              <Route path="finance" element={<FinanceOverviewPage />} />
              <Route path="finance/transactions" element={<TransactionsPage />} />
              <Route path="finance/accounts" element={<AccountsPage />} />
              <Route path="finance/accounts/:id" element={<AccountDetailPage />} />
              <Route path="finance/budgets" element={<BudgetsPage />} />
              <Route path="finance/budgets/:id" element={<BudgetDetailPage />} />
              <Route path="finance/recurring" element={<RecurringPage />} />
              <Route path="finance/installments" element={<InstallmentsPage />} />
              <Route path="finance/installments/:id" element={<InstallmentDetailPage />} />
              <Route path="finance/debts" element={<DebtsPage />} />
              <Route path="finance/goals" element={<GoalsPage />} />
              <Route path="finance/goals/:id" element={<GoalDetailPage />} />
              <Route path="finance/categories" element={<CategoriesPage />} />
              <Route path="finance/currencies" element={<CurrenciesPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </WorkspaceProvider>
      </ToastProvider>
    </I18nProvider>
  );
}

export function App() {
  const qc = useQueryClient();
  const status = useAuthStatus();

  useEffect(
    () =>
      onUnauthorized(() => {
        qc.setQueryData(['auth', 'status'], (s: unknown) => (s ? { ...(s as object), user: null } : s));
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
      }),
    [qc],
  );

  if (status.isLoading) {
    return (
      <Public>
        <LoadingBlock />
      </Public>
    );
  }
  if (status.error || !status.data) {
    return (
      <Public>
        <div className="mx-auto max-w-md p-6 pt-24">
          <ErrorBlock error={status.error ?? 'No response'} onRetry={() => status.refetch()} />
        </div>
      </Public>
    );
  }
  if (status.data.setupRequired) {
    return (
      <Public>
        <SetupPage allowed={status.data.setupAllowedHere} />
      </Public>
    );
  }
  if (!status.data.user) {
    return (
      <Public>
        <LoginPage demo={status.data.demo} />
      </Public>
    );
  }
  return <Private />;
}
