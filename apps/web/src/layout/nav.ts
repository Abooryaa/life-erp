import { Activity, Bell, FileText, LayoutDashboard, Search, Settings, type LucideIcon } from 'lucide-react';
import type { MessageKey } from '../i18n';

export interface NavItem {
  to: string;
  label: MessageKey;
  icon: LucideIcon;
  end?: boolean;
}

export interface NavSection {
  label?: MessageKey;
  items: NavItem[];
}

/**
 * Only modules that are actually built appear here — no dead links.
 * Each phase adds its section (Money, Plan, People, Career, Insights…).
 */
export const NAV: NavSection[] = [
  {
    items: [{ to: '/', label: 'nav.dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'nav.sectionKnowledge',
    items: [{ to: '/documents', label: 'nav.documents', icon: FileText }],
  },
  {
    label: 'nav.sectionSystem',
    items: [
      { to: '/search', label: 'nav.search', icon: Search },
      { to: '/notifications', label: 'nav.notifications', icon: Bell },
      { to: '/activity', label: 'nav.activity', icon: Activity },
      { to: '/settings', label: 'nav.settings', icon: Settings },
    ],
  },
];

/** Bottom bar on phones: 2 items, the + button, 2 items. */
export const MOBILE_TABS: { left: NavItem[]; right: NavItem[] } = {
  left: [
    { to: '/', label: 'nav.home', icon: LayoutDashboard, end: true },
    { to: '/documents', label: 'nav.documents', icon: FileText },
  ],
  right: [{ to: '/search', label: 'nav.search', icon: Search }],
};
