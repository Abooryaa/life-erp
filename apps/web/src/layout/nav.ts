import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Bot,
  Briefcase,
  BriefcaseBusiness,
  CalendarCheck,
  FileUp,
  FlaskConical,
  Gem,
  Workflow,
  GraduationCap,
  Send,
  Sparkles,
  Trophy,
  Bell,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  NotebookPen,
  Sun,
  Building,
  FolderKanban,
  TrendingUp,
  Users,
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
    items: [
      { to: '/today', label: 'nav.today', icon: Sun },
      { to: '/', label: 'nav.dashboard', icon: LayoutDashboard, end: true },
    ],
  },
  {
    label: 'nav.sectionPlan',
    items: [
      { to: '/tasks', label: 'nav.tasks', icon: CheckSquare },
      { to: '/calendar', label: 'nav.calendar', icon: CalendarDays },
      { to: '/goals', label: 'nav.goalsOkr', icon: Target },
      { to: '/notes', label: 'nav.notes', icon: NotebookPen },
    ],
  },
  {
    label: 'nav.sectionBusiness',
    items: [
      { to: '/projects', label: 'nav.projects', icon: FolderKanban },
      { to: '/pipeline', label: 'nav.pipeline', icon: TrendingUp },
      { to: '/people', label: 'nav.people', icon: Users },
      { to: '/companies', label: 'nav.companies', icon: Building },
    ],
  },
  {
    label: 'nav.sectionCareer',
    items: [
      { to: '/career', label: 'nav.career', icon: Briefcase, end: true },
      { to: '/career/applications', label: 'nav.applications', icon: Send },
      { to: '/career/jobs', label: 'nav.jobs', icon: BriefcaseBusiness },
      { to: '/career/achievements', label: 'nav.achievements', icon: Trophy },
      { to: '/career/skills', label: 'nav.skills', icon: Sparkles },
      { to: '/career/learning', label: 'nav.learning', icon: GraduationCap },
    ],
  },
  {
    label: 'nav.sectionMoney',
    items: [
      { to: '/finance', label: 'nav.finance', icon: PieChart, end: true },
      { to: '/finance/transactions', label: 'nav.transactions', icon: ArrowLeftRight },
      { to: '/finance/accounts', label: 'nav.accounts', icon: Landmark },
      { to: '/finance/net-worth', label: 'nav.netWorth', icon: Gem },
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
    label: 'nav.sectionInsights',
    items: [
      { to: '/assistant', label: 'nav.assistant', icon: Bot },
      { to: '/insights', label: 'nav.analytics', icon: BarChart3 },
      { to: '/reviews', label: 'nav.reviews', icon: CalendarCheck },
      { to: '/scenarios', label: 'nav.scenarios', icon: FlaskConical },
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
      { to: '/automations', label: 'nav.automations', icon: Workflow },
      { to: '/import', label: 'nav.import', icon: FileUp },
      { to: '/notifications', label: 'nav.notifications', icon: Bell },
      { to: '/activity', label: 'nav.activity', icon: Activity },
      { to: '/settings', label: 'nav.settings', icon: Settings },
    ],
  },
];

/** Bottom bar on phones: 2 items, the + button, 1 item + More. */
export const MOBILE_TABS: { left: NavItem[]; right: NavItem[] } = {
  left: [
    { to: '/today', label: 'nav.today', icon: Sun },
    { to: '/finance', label: 'nav.money', icon: Wallet },
  ],
  right: [{ to: '/tasks', label: 'nav.tasks', icon: CheckSquare }],
};
