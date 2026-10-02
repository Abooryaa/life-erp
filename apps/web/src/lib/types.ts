export interface PublicUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: string;
  totpEnabled: boolean;
}

export interface AuthStatus {
  setupRequired: boolean;
  setupAllowedHere: boolean;
  demo: boolean;
  user: PublicUser | null;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  kind: 'personal' | 'business';
  description: string | null;
  industry: string | null;
  color: string;
  currency: string;
  website: string | null;
  notes: string | null;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedEntity {
  id: string;
  type: string;
  title: string;
  url: string;
  subtitle?: string | null;
  workspaceId?: string | null;
}

export interface LinkItem {
  linkId: string;
  relation: string;
  note: string | null;
  createdAt: string;
  entity: ResolvedEntity;
}

export interface DocumentItem {
  id: string;
  workspaceId: string | null;
  title: string;
  originalName: string;
  description: string | null;
  docType: string;
  documentDate: string | null;
  expiresOn: string | null;
  createdAt: string;
  updatedAt: string;
  size: number;
  mime: string;
  fileId: string;
  tags: string[];
  links?: LinkItem[];
}

export interface SearchHit {
  type: string;
  id: string;
  title: string;
  url: string;
  subtitle: string | null;
  snippet: string;
  workspaceId: string | null;
}

export interface NotificationItem {
  id: string;
  createdAt: string;
  severity: 'critical' | 'warning' | 'reminder' | 'info';
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
}

export interface AuditItem {
  id: string;
  at: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string | null;
  ip: string | null;
}

export interface TagItem {
  id: string;
  name: string;
  color: string | null;
  usage: number;
}
