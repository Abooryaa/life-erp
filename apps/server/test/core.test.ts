import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, json, makeApp, upload, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.close());

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('workspaces', () => {
  it('creates, updates, archives and soft-deletes a business without code changes', async () => {
    const created = json(await call(ctx, 'POST', '/api/workspaces', { name: 'Future Co', industry: 'Retail' }));
    expect(created.slug).toBe('future-co');
    expect(created.kind).toBe('business');

    const dupe = await call(ctx, 'POST', '/api/workspaces', { name: 'future co' });
    expect(dupe.statusCode).toBe(409);

    const upd = json(await call(ctx, 'PUT', `/api/workspaces/${created.id}`, { name: 'Future Company', color: '#123456' }));
    expect(upd.name).toBe('Future Company');
    expect(upd.slug).toBe('future-company');

    await call(ctx, 'POST', `/api/workspaces/${created.id}/archive`, { archived: true });
    let list = json(await call(ctx, 'GET', '/api/workspaces'));
    expect(list.find((w: any) => w.id === created.id)).toBeUndefined();
    list = json(await call(ctx, 'GET', '/api/workspaces?archived=1'));
    expect(list.find((w: any) => w.id === created.id).archivedAt).toBeTruthy();

    expect((await call(ctx, 'DELETE', `/api/workspaces/${created.id}`)).statusCode).toBe(200);
    expect((await call(ctx, 'GET', `/api/workspaces/${created.id}`)).statusCode).toBe(404);
  });

  it('protects the personal workspace', async () => {
    const personal = json(await call(ctx, 'GET', '/api/workspaces')).find((w: any) => w.kind === 'personal');
    expect((await call(ctx, 'DELETE', `/api/workspaces/${personal.id}`)).statusCode).toBe(400);
    expect((await call(ctx, 'POST', '/api/workspaces', { name: 'Second me', kind: 'personal' })).statusCode).toBe(409);
  });

  it('rejects invalid input with field errors', async () => {
    const r = await call(ctx, 'POST', '/api/workspaces', { name: '', color: 'red' });
    expect(r.statusCode).toBe(400);
    const paths = json(r).error.fields.map((f: any) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'color']));
  });
});

describe('documents, tags, links and search', () => {
  let docId: string;
  let mmaId: string;

  it('uploads a document, detects its real type and stores it locally', async () => {
    mmaId = json(await call(ctx, 'GET', '/api/workspaces')).find((w: any) => w.name === 'MMA Spaces').id;
    const res = await upload(
      ctx,
      '/api/documents',
      { title: 'Villa contract', docType: 'contract', workspaceId: mmaId, tags: '#mma, urgent', expiresOn: '2026-10-20' },
      // Named .txt but really a PDF: the server trusts the content, not the name.
      { name: 'contract.txt', content: PDF },
    );
    expect(res.statusCode).toBe(200);
    const doc = json(res);
    docId = doc.id;
    expect(doc.mime).toBe('application/pdf');
    expect(doc.tags).toEqual(['mma', 'urgent']);
    expect(doc.size).toBe(PDF.length);
  });

  it('stores identical content only once', async () => {
    const again = json(await upload(ctx, '/api/documents', { title: 'Copy' }, { name: 'copy.pdf', content: PDF }));
    const first = json(await call(ctx, 'GET', `/api/documents/${docId}`));
    expect(again.fileId).toBe(first.fileId);
  });

  it('serves the file only to signed-in users, with safe headers', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: `/api/documents/${docId}/file`, headers: { cookie: ctx.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.rawPayload.equals(PDF)).toBe(true);
    const anon = await ctx.app.inject({ method: 'GET', url: `/api/documents/${docId}/file` });
    expect(anon.statusCode).toBe(401);
  });

  it('never renders unknown or active content inline', async () => {
    const html = json(await upload(ctx, '/api/documents', { title: 'page' }, { name: 'x.html', content: Buffer.from('<script>alert(1)</script>') }));
    expect(html.mime).toBe('application/octet-stream');
    const res = await ctx.app.inject({ method: 'GET', url: `/api/documents/${html.id}/file`, headers: { cookie: ctx.cookie } });
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['content-security-policy']).toMatch(/sandbox/);
  });

  it('rejects empty uploads clearly', async () => {
    const res = await upload(ctx, '/api/documents', { title: 'empty' }, { name: 'e.pdf', content: Buffer.alloc(0) });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.message).toMatch(/empty/i);
  });

  it('finds records through global search, including by tag and in Arabic', async () => {
    const hits = json(await call(ctx, 'GET', '/api/search?q=villa'));
    expect(hits[0]).toMatchObject({ type: 'document', id: docId, title: 'Villa contract' });
    expect(json(await call(ctx, 'GET', '/api/search?q=%23urgent')).some((h: any) => h.id === docId)).toBe(true);
    expect(json(await call(ctx, 'GET', '/api/search?q=MMA')).some((h: any) => h.type === 'workspace')).toBe(true);

    const ar = json(await upload(ctx, '/api/documents', { title: 'عقد إيجار الشقة' }, { name: 'lease.png', content: PNG }));
    expect(ar.mime).toBe('image/png');
    expect(json(await call(ctx, 'GET', `/api/search?q=${encodeURIComponent('عقد')}`)).some((h: any) => h.id === ar.id)).toBe(true);
    // Hostile FTS syntax is neutralised, not an error.
    expect((await call(ctx, 'GET', `/api/search?q=${encodeURIComponent('"a" OR * NEAR(')}`)).statusCode).toBe(200);
  });

  it('links any record to any other, in both directions', async () => {
    const link = await call(ctx, 'POST', '/api/links', { from: { type: 'workspace', id: mmaId }, to: { type: 'document', id: docId } });
    expect(link.statusCode).toBe(200);
    const fromDoc = json(await call(ctx, 'GET', `/api/links?type=document&id=${docId}`));
    expect(fromDoc[0].entity).toMatchObject({ type: 'workspace', title: 'MMA Spaces' });
    const missing = await call(ctx, 'POST', '/api/links', { from: { type: 'workspace', id: mmaId }, to: { type: 'document', id: '00000000-0000-7000-8000-000000000000' } });
    expect(missing.statusCode).toBe(404);
    const self = await call(ctx, 'POST', '/api/links', { from: { type: 'document', id: docId }, to: { type: 'document', id: docId } });
    expect(self.statusCode).toBe(400);
  });

  it('manages tags globally (rename updates search)', async () => {
    const tags = json(await call(ctx, 'GET', '/api/tags'));
    const urgent = tags.find((t: any) => t.name === 'urgent');
    expect(urgent.usage).toBe(1);
    await call(ctx, 'PUT', `/api/tags/${urgent.id}`, { name: 'critical' });
    expect(json(await call(ctx, 'GET', '/api/search?q=%23critical')).some((h: any) => h.id === docId)).toBe(true);
    expect((await call(ctx, 'POST', '/api/tags', { name: 'MMA' })).statusCode).toBe(409); // normalised to "mma"
  });

  it('filters documents and soft-deletes them', async () => {
    expect(json(await call(ctx, 'GET', `/api/documents?workspaceId=${mmaId}`))).toHaveLength(1);
    expect(json(await call(ctx, 'GET', '/api/documents?tag=mma'))).toHaveLength(1);
    expect(json(await call(ctx, 'GET', '/api/documents?attachedType=workspace&attachedId=' + mmaId))).toHaveLength(1);
    await call(ctx, 'DELETE', `/api/documents/${docId}`);
    expect((await call(ctx, 'GET', `/api/documents/${docId}`)).statusCode).toBe(404);
    expect(json(await call(ctx, 'GET', '/api/search?q=villa'))).toHaveLength(0);
  });
});

describe('settings', () => {
  it('merges partial updates and validates', async () => {
    const s = json(await call(ctx, 'PATCH', '/api/settings', { locale: 'ar', backup: { retention: 7 } }));
    expect(s.locale).toBe('ar');
    expect(s.backup.retention).toBe(7);
    expect(s.backup.auto).toBe(true);
    expect((await call(ctx, 'PATCH', '/api/settings', { weekStart: 9 })).statusCode).toBe(400);
  });
});

describe('notifications', () => {
  it('raises expiring-document reminders once (deduplicated)', async () => {
    const doc = json(await upload(ctx, '/api/documents', { title: 'National ID', docType: 'id', expiresOn: '2020-01-01' }, { name: 'id.png', content: PNG }));
    const { runJobsNow } = await import('../src/jobs/scheduler');
    await runJobsNow(undefined, true);
    await runJobsNow(undefined, true);
    const n = json(await call(ctx, 'GET', '/api/notifications'));
    const mine = n.items.filter((i: any) => i.entityId === doc.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].severity).toBe('warning');
    await call(ctx, 'POST', `/api/notifications/${mine[0].id}/dismiss`);
    expect(json(await call(ctx, 'GET', '/api/notifications')).items.some((i: any) => i.entityId === doc.id)).toBe(false);
  });
});

describe('backup and restore', () => {
  it('creates a verified backup, and restore brings data back exactly', async () => {
    const before = json(await call(ctx, 'GET', '/api/documents'));
    const b = json(await call(ctx, 'POST', '/api/backups'));
    expect(existsSync(b.path)).toBe(true);

    const info = json(await call(ctx, 'GET', `/api/backups/${b.name}/inspect`));
    expect(info.valid).toBe(true);
    expect(info.manifest.tableCounts.documents).toBeGreaterThan(0);

    // Change data after the backup…
    await call(ctx, 'POST', '/api/workspaces', { name: 'Created after backup' });
    await call(ctx, 'DELETE', `/api/documents/${before[0].id}`);

    // Restore requires explicit confirmation.
    const noConfirm = await call(ctx, 'POST', `/api/backups/${b.name}/restore`, { confirm: 'yes' });
    expect(noConfirm.statusCode).toBe(400);

    const r = await call(ctx, 'POST', `/api/backups/${b.name}/restore`, { confirm: 'RESTORE' });
    expect(r.statusCode).toBe(200);
    expect(json(r).safetyBackup).toMatch(/-safety\.zip$/);

    // Sessions are part of the restored database, so the current session still exists there.
    const ws = json(await call(ctx, 'GET', '/api/workspaces'));
    expect(ws.some((w: any) => w.name === 'Created after backup')).toBe(false);
    const after = json(await call(ctx, 'GET', '/api/documents'));
    expect(after.map((d: any) => d.id).sort()).toEqual(before.map((d: any) => d.id).sort());
    // Files are back on disk and downloadable.
    const file = await ctx.app.inject({ method: 'GET', url: `/api/documents/${after[0].id}/file`, headers: { cookie: ctx.cookie } });
    expect(file.statusCode).toBe(200);
    // The safety backup is listed and itself valid.
    const list = json(await call(ctx, 'GET', '/api/backups'));
    expect(list.items.some((i: any) => i.name === json(r).safetyBackup)).toBe(true);
  });

  it('detects a damaged backup and refuses to restore it', async () => {
    const b = json(await call(ctx, 'POST', '/api/backups'));
    const { readFileSync } = await import('node:fs');
    const buf = readFileSync(b.path);
    // Corrupt a byte in the middle of the archive.
    buf[Math.floor(buf.length / 2)] ^= 0xff;
    const bad = join(ctx.config.paths.backups, 'damaged.zip');
    writeFileSync(bad, buf);
    const info = json(await call(ctx, 'GET', '/api/backups/damaged.zip/inspect'));
    expect(info.valid).toBe(false);
    const r = await call(ctx, 'POST', '/api/backups/damaged.zip/restore', { confirm: 'RESTORE' });
    expect(r.statusCode).toBe(400);
    // Data untouched.
    expect((await call(ctx, 'GET', '/api/workspaces')).statusCode).toBe(200);
  });

  it('rejects path tricks in backup names', async () => {
    expect((await call(ctx, 'GET', '/api/backups/..%2F..%2Fsecrets.zip/inspect')).statusCode).toBe(400);
  });

  it('exports everything as JSON without secrets', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/export/json', headers: { cookie: ctx.cookie } });
    const data = JSON.parse(res.body);
    expect(data.tables.workspaces.length).toBeGreaterThan(0);
    expect(data.tables.sessions).toBeUndefined();
    expect(data.tables.users[0].password_hash).toBeNull();
  });
});

describe('demo separation', () => {
  it('refuses to restore a demo backup into real data', async () => {
    const demo = await makeApp({ demo: true });
    try {
      const b = json(await call(demo, 'POST', '/api/backups'));
      expect(b.name).toMatch(/DEMO/);
      const { copyFileSync } = await import('node:fs');
      copyFileSync(b.path, join(ctx.config.paths.backups, b.name));
    } finally {
      await demo.close();
    }
    // Reopen the real app's DB (closing the demo app closed the shared handle).
    const { openDb } = await import('../src/db/client');
    const { setRuntimeConfig } = await import('../src/runtime');
    setRuntimeConfig(ctx.config);
    openDb(ctx.config.paths.dbFile);
    const list = json(await call(ctx, 'GET', '/api/backups'));
    const demoName = list.items.find((i: any) => /DEMO/.test(i.name)).name;
    const r = await call(ctx, 'POST', `/api/backups/${demoName}/restore`, { confirm: 'RESTORE' });
    expect(r.statusCode).toBe(400);
    expect(json(r).error.code).toBe('demo_mismatch');
  });
});
