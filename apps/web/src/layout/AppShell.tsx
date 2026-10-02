import * as DM from '@radix-ui/react-dropdown-menu';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell, Building2, Check, ChevronsUpDown, LogOut, Menu, Plus, Search, Settings, User, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { BrandMark, BrandName } from '../components/Brand';
import { Button } from '../components/ui/button';
import { Dot } from '../components/ui/feedback';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useAuthStatus } from '../lib/hooks';
import type { NotificationItem } from '../lib/types';
import { useWorkspace } from '../lib/workspace';
import { MOBILE_TABS, NAV, type NavItem } from './nav';
import { UiProvider, useUI } from './ui-context';

export function AppShell() {
  return (
    <UiProvider>
      <Shell />
    </UiProvider>
  );
}

function Shell() {
  const { t } = useI18n();
  const status = useAuthStatus();
  const ui = useUI();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  useEffect(() => setDrawer(false), [location.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.openSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui]);

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-e border-line bg-surface md:flex">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-pop safe-top">
            <div className="flex justify-end p-2">
              <Button variant="ghost" size="icon" onClick={() => setDrawer(false)} aria-label={t('common.close')}>
                <X className="size-5" />
              </Button>
            </div>
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {status.data?.demo && (
          <div className="bg-warn px-4 py-1.5 text-center text-[12.5px] font-medium text-white">{t('app.demoBanner')}</div>
        )}
        <TopBar onMenu={() => setDrawer(true)} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-4 pb-28 md:px-8 md:pt-6 md:pb-12">
          <Outlet />
        </main>
      </div>

      <MobileTabBar onMore={() => setDrawer(true)} />
    </div>
  );
}

function SidebarContent() {
  const { t } = useI18n();
  const { workspaces } = useWorkspace();
  const ui = useUI();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
        <BrandMark className="size-7" />
        <BrandName className="text-[15px]" />
      </div>
      <div className="px-3 pb-3">
        <WorkspaceSwitcher full />
      </div>
      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-4 scrollbar-thin">
        {NAV.map((section, i) => (
          <div key={i}>
            {section.label && <p className="mb-1 px-2.5 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">{t(section.label)}</p>}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.to}>
                  <SideLink item={item} />
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <p className="mb-1 flex items-center justify-between px-2.5 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">
            {t('nav.sectionWorkspaces')}
            <button className="rounded p-0.5 hover:bg-surface-2 hover:text-ink" onClick={() => ui.openWorkspaceForm()} aria-label={t('ws.newBusiness')}>
              <Plus className="size-3.5" />
            </button>
          </p>
          <ul className="space-y-0.5">
            {workspaces.map((w) => (
              <li key={w.id}>
                <NavLink
                  to={`/workspaces/${w.id}`}
                  className={({ isActive }) =>
                    clsx('flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px]', isActive ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:bg-surface-2')
                  }
                >
                  <Dot color={w.color} />
                  <span className="truncate">{w.name}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </div>
  );
}

function SideLink({ item }: { item: NavItem }) {
  const { t } = useI18n();
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] transition-colors',
          isActive ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      {t(item.label)}
    </NavLink>
  );
}

export function WorkspaceSwitcher({ full }: { full?: boolean }) {
  const { t, dir } = useI18n();
  const { current, setCurrentId, workspaces } = useWorkspace();
  const ui = useUI();
  return (
    <DM.Root dir={dir}>
      <DM.Trigger asChild>
        <button
          className={clsx(
            'flex items-center gap-2 rounded-lg border border-line text-start hover:bg-surface-2',
            full ? 'w-full px-2.5 py-2' : 'max-w-[55vw] px-2 py-1.5',
          )}
          aria-label={t('ws.switch')}
        >
          {current ? <Dot color={current.color} /> : <Building2 className="size-4 shrink-0 text-ink-3" />}
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{current?.name ?? t('ws.all')}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-ink-3" />
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="start" sideOffset={6} className="z-50 min-w-60 rounded-xl border border-line bg-surface p-1 shadow-pop">
          <MenuItem onSelect={() => setCurrentId(null)} active={!current}>
            <Building2 className="size-4 text-ink-3" />
            {t('ws.all')}
          </MenuItem>
          <DM.Separator className="my-1 h-px bg-line" />
          {workspaces.map((w) => (
            <MenuItem key={w.id} onSelect={() => setCurrentId(w.id)} active={current?.id === w.id}>
              <Dot color={w.color} />
              <span className="truncate">{w.name}</span>
            </MenuItem>
          ))}
          <DM.Separator className="my-1 h-px bg-line" />
          <MenuItem onSelect={() => ui.openWorkspaceForm()}>
            <Plus className="size-4 text-ink-3" />
            {t('ws.newBusiness')}
          </MenuItem>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function MenuItem({ children, onSelect, active }: { children: React.ReactNode; onSelect: () => void; active?: boolean }) {
  return (
    <DM.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] outline-none data-[highlighted]:bg-surface-2"
    >
      {children}
      {active && <Check className="ms-auto size-4 text-accent" />}
    </DM.Item>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { t } = useI18n();
  const ui = useUI();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur safe-top">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 px-3 md:px-8">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenu} aria-label={t('nav.more')}>
          <Menu className="size-5" />
        </Button>
        <div className="md:hidden">
          <WorkspaceSwitcher />
        </div>
        <button
          onClick={ui.openSearch}
          className="hidden h-9 w-full max-w-md items-center gap-2 rounded-lg border border-line bg-surface px-3 text-ink-3 hover:border-line-strong md:flex"
        >
          <Search className="size-4" />
          <span className="flex-1 text-start text-[13.5px]">{t('search.placeholder')}</span>
          <kbd className="rounded border border-line px-1.5 text-[11px]" dir="ltr">
            {t('search.shortcut')}
          </kbd>
        </button>
        <div className="ms-auto flex items-center gap-1">
          <div className="hidden md:block">
            <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={ui.openQuickAdd}>
              {t('nav.add')}
            </Button>
          </div>
          <NotificationBell />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

function NotificationBell() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: NotificationItem[]; counts: { unread: number; critical: number } }>('/api/notifications'),
    refetchInterval: 60_000,
  });
  const unread = data?.counts.unread ?? 0;
  return (
    <Button variant="ghost" size="icon" className="relative" onClick={() => navigate('/notifications')} aria-label={`${t('nav.notifications')} (${unread})`}>
      <Bell className="size-5" />
      {unread > 0 && (
        <span
          className={clsx(
            'num absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white',
            data?.counts.critical ? 'bg-neg' : 'bg-accent',
          )}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Button>
  );
}

function UserMenu() {
  const { t, dir } = useI18n();
  const status = useAuthStatus();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = status.data?.user;
  const initials = (user?.fullName ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <DM.Root dir={dir}>
      <DM.Trigger asChild>
        <button className="ms-1 flex size-8 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-canvas" aria-label={user?.fullName}>
          {initials}
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={6} className="z-50 min-w-56 rounded-xl border border-line bg-surface p-1 shadow-pop">
          <div className="px-2.5 py-2">
            <p className="font-medium">{user?.fullName}</p>
            <p className="text-[12.5px] text-ink-3" dir="ltr">
              {user?.email}
            </p>
          </div>
          <DM.Separator className="my-1 h-px bg-line" />
          <MenuItem onSelect={() => navigate('/settings/profile')}>
            <User className="size-4 text-ink-3" />
            {t('settings.profile')}
          </MenuItem>
          <MenuItem onSelect={() => navigate('/settings')}>
            <Settings className="size-4 text-ink-3" />
            {t('nav.settings')}
          </MenuItem>
          <DM.Separator className="my-1 h-px bg-line" />
          <MenuItem
            onSelect={async () => {
              await api.post('/api/auth/logout').catch(() => {});
              qc.clear();
              await qc.invalidateQueries({ queryKey: ['auth'] });
              navigate('/');
            }}
          >
            <LogOut className="size-4 text-ink-3" />
            {t('auth.signOut')}
          </MenuItem>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function MobileTabBar({ onMore }: { onMore: () => void }) {
  const { t } = useI18n();
  const ui = useUI();
  const tab = (item: NavItem) => {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        className={({ isActive }) => clsx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-accent' : 'text-ink-3')}
      >
        <Icon className="size-[22px]" />
        {t(item.label)}
      </NavLink>
    );
  };
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur safe-bottom md:hidden">
      <div className="flex items-stretch">
        {MOBILE_TABS.left.map(tab)}
        <div className="flex flex-1 items-center justify-center">
          <button onClick={ui.openQuickAdd} className="-mt-5 flex size-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-pop" aria-label={t('quick.title')}>
            <Plus className="size-7" />
          </button>
        </div>
        {MOBILE_TABS.right.map(tab)}
        <button onClick={onMore} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-ink-3">
          <Menu className="size-[22px]" />
          {t('nav.more')}
        </button>
      </div>
    </nav>
  );
}
