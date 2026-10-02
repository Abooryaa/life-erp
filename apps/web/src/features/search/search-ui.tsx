import {
  Briefcase,
  GraduationCap,
  Send,
  Sparkles,
  Trophy,
  Building2,
  Calendar,
  CalendarClock,
  CheckSquare,
  FileText,
  Folder,
  HandCoins,
  Landmark,
  NotebookPen,
  PiggyBank,
  Receipt,
  Target,
  TrendingUp,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { MessageKey } from '../../i18n';

const ICONS: Record<string, LucideIcon> = {
  workspace: Building2,
  document: FileText,
  note: NotebookPen,
  task: CheckSquare,
  project: Folder,
  person: User,
  organization: Users,
  transaction: Receipt,
  account: Landmark,
  goal: Target,
  event: Calendar,
  opportunity: TrendingUp,
  installment: CalendarClock,
  debt: HandCoins,
  savings_goal: PiggyBank,
  budget: Wallet,
  job_application: Send,
  employment: Briefcase,
  skill: Sparkles,
  achievement: Trophy,
  learning: GraduationCap,
};

export function EntityIcon({ type }: { type: string }) {
  const Icon = ICONS[type] ?? FileText;
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
      <Icon className="size-4" />
    </span>
  );
}

export function entityLabel(t: (k: MessageKey) => string, type: string) {
  const key = `entity.${type}` as MessageKey;
  const label = t(key);
  return label === key ? t('entity.other') : label;
}

/** Render an FTS snippet, where matches are wrapped in [[ ]] by the server. Never uses innerHTML. */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\[\[.*?\]\])/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('[[') && p.endsWith(']]') ? (
          <mark key={i} className="rounded bg-accent-soft px-0.5 text-ink">
            {p.slice(2, -2)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
