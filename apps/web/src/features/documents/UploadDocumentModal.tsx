import { DOCUMENT_TYPES } from '@life-erp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Textarea, TextField } from '../../components/ui/form';
import { useI18n } from '../../i18n';
import { uploadWithProgress } from '../../lib/api';
import { useFormState } from '../../lib/hooks';
import type { DocumentItem } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { TagInput } from '../shared/TagEditor';
import { useDocTypeLabel } from './doc-ui';

export function UploadDocumentModal({
  open,
  onOpenChange,
  attachTo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  attachTo?: { type: string; id: string; workspaceId?: string | null };
}) {
  const { t, fmt } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const typeLabel = useDocTypeLabel();
  const { currentId, workspaces } = useWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const form = useFormState({
    title: '',
    docType: 'other' as string,
    workspaceId: '' as string,
    documentDate: '',
    expiresOn: '',
    description: '',
    tags: [] as string[],
  });

  useEffect(() => {
    if (open) {
      form.reset();
      setFile(null);
      setProgress(null);
      form.set('workspaceId', attachTo?.workspaceId ?? currentId ?? '');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    setFile(f);
    if (!form.values.title) form.set('title', f.name.replace(/\.[^.]+$/, ''));
    if (f.type.startsWith('image/') && form.values.docType === 'other') form.set('docType', 'photo');
  };

  async function submit() {
    if (!file) {
      form.setFormError(t('docs.dropHere'));
      return;
    }
    const v = form.values;
    const fd = new FormData();
    // Text fields first so the server reads them before the file stream.
    fd.append('title', v.title);
    fd.append('docType', v.docType);
    if (v.workspaceId) fd.append('workspaceId', v.workspaceId);
    if (v.documentDate) fd.append('documentDate', v.documentDate);
    if (v.expiresOn) fd.append('expiresOn', v.expiresOn);
    if (v.description) fd.append('description', v.description);
    if (v.tags.length) fd.append('tags', v.tags.join(','));
    if (attachTo) {
      fd.append('attachType', attachTo.type);
      fd.append('attachId', attachTo.id);
    }
    fd.append('file', file, file.name);
    setProgress(0);
    try {
      const doc = await uploadWithProgress<DocumentItem>('/api/documents', fd, setProgress);
      await qc.invalidateQueries({ queryKey: ['documents'] });
      await qc.invalidateQueries({ queryKey: ['links'] });
      onOpenChange(false);
      toast.success(t('common.saved'));
      if (!attachTo) navigate(`/documents/${doc.id}`);
    } catch (err) {
      form.fail(err);
    } finally {
      setProgress(null);
    }
  }

  const v = form.values;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('docs.uploadTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={progress !== null} disabled={!file}>
            {progress !== null ? `${t('docs.uploading')} ${Math.round(progress * 100)}%` : t('docs.upload')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={form.formError} />
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pick(e.dataTransfer.files[0]);
          }}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragOver ? 'border-accent bg-accent-soft' : 'border-line-strong hover:bg-surface-2'}`}
        >
          <UploadCloud className="size-7 text-ink-3" />
          {file ? (
            <p className="font-medium break-all">
              {file.name} <span className="font-normal text-ink-3">· {fmt.bytes(file.size)}</span>
            </p>
          ) : (
            <p className="text-ink-2">{t('docs.dropHere')}</p>
          )}
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        <div className="md:hidden">
          <Button size="sm" variant="secondary" icon={<Camera className="size-4" />} onClick={() => camRef.current?.click()}>
            {t('docs.takePhoto')}
          </Button>
        </div>
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

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
          <Field label={t('common.workspace')} optional>
            <Select value={v.workspaceId} onChange={(e) => form.set('workspaceId', e.target.value)}>
              <option value="">{t('common.noWorkspace')}</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('docs.documentDate')} optional error={form.errors.documentDate}>
            <Input type="date" value={v.documentDate} onChange={(e) => form.set('documentDate', e.target.value)} />
          </Field>
          <Field label={t('docs.expiresOn')} optional hint={t('docs.expiresHint')} error={form.errors.expiresOn}>
            <Input type="date" value={v.expiresOn} onChange={(e) => form.set('expiresOn', e.target.value)} />
          </Field>
        </div>
        <Field label={t('common.tags')} optional>
          <TagInput value={v.tags} onChange={(tags) => form.set('tags', tags)} />
        </Field>
        <Field label={t('common.description')} optional>
          <Textarea value={v.description} onChange={(e) => form.set('description', e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
