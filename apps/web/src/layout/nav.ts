import {
  Activity,
  ArrowLeftRight,
  Bell,
  CalendarClock,
  Coins,
  FileText,
  HandCoins,
  LayoutDashboard,
  Landmark,
  PieChart,
  PiggyBank,
  Repeat,
  Search,
  Settings,
  Shapes,
  Target,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
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
 * Each phase adds its section (Plan, People, Career, Insights…).
 */
export const NAV: NavSection[] = [
  {
    items: [{ to: '/', label: 'nav.dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'nav.sectionMoney',
    items: [
      { to: '/finance', label: 'nav.finance', icon: PieChart, end: true },
      { to: '/finance/transactions', label: 'nav.transactions', icon: ArrowLeftRight },
      { to: '/finance/accounts', label: 'nav.accounts', icon: Landmark },
      { to: '/finance/budgets', label: 'nav.budgets', icon: Wallet },
      { to: '/finance/recurring', label: 'nav.recurring', icon: Repeat },
      { to: '/finance/installments', label: 'nav.installments', icon: CalendarClock },
      { to: '/finance/debts', label: 'nav.debts', icon: HandCoins },
      { to: '/finance/goals', label: 'nav.goals', icon: PiggyBank },
      { to: '/finance/categories', label: 'nav.categories', icon: Shapes },
      { to: '/finance/currencies', label: 'nav.currencies', icon: Coins },
    ],
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

/** Bottom bar on phones: 2 items, the + button, 1 item + More. */
export const MOBILE_TABS: { left: NavItem[]; right: NavItem[] } = {
  left: [
    { to: '/', label: 'nav.home', icon: LayoutDashboard, end: true },
    { to: '/finance', label: 'nav.money', icon: Target },
  ],
  right: [{ to: '/finance/transactions', label: 'nav.transactions', icon: ArrowLeftRight }],
};
