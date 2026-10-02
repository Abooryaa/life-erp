import { DOCUMENT_TYPES } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Dot, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Textarea, TextField } from '../../components/ui/form';
import { DataRow, PageHeader, Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import type { DocumentItem } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { LinksPanel } from '../shared/LinksPanel';
import { CustomFieldsPanel } from '../tools/CustomFields';
import { EntityTags } from '../shared/TagEditor';
import { ExpiryBadge, useDocTypeLabel } from './doc-ui';

export function DocumentDetailPage() {
  const { id = '' } = useParams();
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const typeLabel = useDocTypeLabel();
  const { byId } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { data: doc, isLoading, error, refetch } = useQuery({ queryKey: ['documents', id], queryFn: () => api.get<DocumentItem>(`/api/documents/${id}`) });
  const del = useAction(() => api.del(`/api/documents/${id}`), {
    invalidate: [['documents']],
    onSuccess: () => navigate('/documents'),
  });

  if (isLoading) return <LoadingBlock />;
  if (error || !doc) return <ErrorBlock error={error ?? 'Not found'} onRetry={refetch} />;

  const fileUrl = `/api/documents/${doc.id}/file`;
  const ws = byId(doc.workspaceId);
  const canPreview = doc.mime.startsWith('image/') || doc.mime === 'application/pdf';

  return (
    <div>
      <PageHeader
        back={
          <Link to="/documents" className="mb-1 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {t('docs.title')}
          </Link>
        }
        title={doc.title}
        subtitle={
          <span className="inline-flex items-center gap-2">
            {typeLabel(doc.docType)} <ExpiryBadge expiresOn={doc.expiresOn} />
          </span>
        }
        actions={
          <>
            <a href={`${fileUrl}?download=1`}>
              <Button icon={<Download className="size-4" />}>{t('common.download')}</Button>
            </a>
            <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
              {t('common.edit')}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setDeleting(true)} aria-label={t('common.delete')}>
              <Trash2 className="size-4 text-neg" />
            </Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title={t('docs.preview')} padded={false}>
          {canPreview ? (
            doc.mime === 'application/pdf' ? (
              <iframe src={fileUrl} title={doc.title} className="h-[70vh] w-full rounded-b-card" />
            ) : (
              <div className="flex justify-center bg-surface-2 p-4">
                <img src={fileUrl} alt={doc.title} className="max-h-[70vh] max-w-full rounded-lg object-contain" />
              </div>
            )
          ) : (
            <p className="p-6 text-center text-ink-3">{t('docs.noPreview')}</p>
          )}
        </Panel>
        <div className="space-y-5">
          <Panel title={t('common.details')}>
            <dl>
              <DataRow label={t('docs.original')}>
                <span className="text-[13px] break-all">{doc.originalName}</span>
              </DataRow>
              <DataRow label={t('common.size')}>{fmt.bytes(doc.size)}</DataRow>
              <DataRow label={t('common.workspace')}>
                {ws ? (
                  <span className="inline-flex items-center gap-2">
                    <Dot color={ws.color} />
                    {ws.name}
                  </span>
                ) : (
                  '—'
                )}
              </DataRow>
              <DataRow label={t('docs.documentDate')}>{doc.documentDate ? fmt.date(doc.documentDate) : '—'}</DataRow>
              <DataRow label={t('docs.expiresOn')}>{doc.expiresOn ? fmt.date(doc.expiresOn) : '—'}</DataRow>
              <DataRow label={t('common.created')}>{fmt.dateTime(doc.createdAt)}</DataRow>
            </dl>
            {doc.description && <p className="mt-3 text-[13.5px] whitespace-pre-wrap text-ink-2">{doc.description}</p>}
            <div className="mt-4">
              <p className="mb-1.5 text-[13px] font-medium text-ink-2">{t('common.tags')}</p>
              <EntityTags type="document" id={doc.id} tags={doc.tags} invalidate={[['documents']]} />
            </div>
          </Panel>
          <CustomFieldsPanel type="document" id={doc.id} />
          <LinksPanel type="document" id={doc.id} />
        </div>
      </div>
      <EditDocumentModal doc={doc} open={editing} onOpenChange={setEditing} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('common.deleteConfirm', { name: doc.title })}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={() => del.mutate(undefined)}
      />
    </div>
  );
}

function EditDocumentModal({ doc, open, onOpenChange }: { doc: DocumentItem; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const typeLabel = useDocTypeLabel();
  const { workspaces } = useWorkspace();
  const init = () => ({
    title: doc.title,
    docType: doc.docType,
    workspaceId: doc.workspaceId ?? '',
    documentDate: doc.documentDate ?? '',
    expiresOn: doc.expiresOn ?? '',
    description: doc.description ?? '',
  });
  const form = useFormState(init());
  useEffect(() => {
    if (open) form.setValues(init());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(
    () => {
      const v = form.values;
      return api.put(`/api/documents/${doc.id}`, {
        ...v,
        workspaceId: v.workspaceId || null,
        documentDate: v.documentDate || null,
        expiresOn: v.expiresOn || null,
        description: v.description || null,
      });
    },
    { invalidate: [['documents']], success: t('common.saved'), onSuccess: () => onOpenChange(false), silentFieldErrors: true },
  );
  const v = form.values;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('common.edit')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={form.formError} />
        <TextField label={t('common.name')} value={v.title} onChange={(e) => form.set('title', e.target.value)} error={form.errors.title} />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('docs.docType')}>
            <Select value={v.docType} onChange={(e) => form.set('docType', e.target.value)}>
              {DOCUMENT_TYPES.map((d) => (
                <option key={d} value={d}>
                  {typeLabel(d)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.workspace')}>
            <Select value={v.workspaceId} onChange={(e) => form.set('workspaceId', e.target.value)}>
              <option value="">{t('common.noWorkspace')}</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('docs.documentDate')} error={form.errors.documentDate}>
            <Input type="date" value={v.documentDate} onChange={(e) => form.set('documentDate', e.target.value)} />
          </Field>
          <Field label={t('docs.expiresOn')} error={form.errors.expiresOn}>
            <Input type="date" value={v.expiresOn} onChange={(e) => form.set('expiresOn', e.target.value)} />
          </Field>
        </div>
        <Field label={t('common.description')}>
          <Textarea value={v.description} onChange={(e) => form.set('description', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
