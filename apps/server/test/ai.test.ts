import { createServer, type IncomingMessage, type Server } from 'node:http';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSqlite } from '../src/db/client';
import { setAiRunnerForTests } from '../src/modules/ai/service';
import { getConfig } from '../src/runtime';
import { call, json, makeApp, type TestCtx } from './helpers';

let ctx: TestCtx;
const post = async (url: string, body?: unknown, expectStatus = 200) => {
  const r = await call(ctx, 'POST', url, body);
  if (r.statusCode !== expectStatus) throw new Error(`${url} → ${r.statusCode}: ${r.body}`);
  return json(r);
};
const get = async (url: string) => json(await call(ctx, 'GET', url));
const patchAi = async (ai: Record<string, unknown>) => {
  const current = (await get('/api/settings')).ai;
  const r = await call(ctx, 'PATCH', '/api/settings', { ai: { ...current, ...ai } });
  if (r.statusCode !== 200) throw new Error(r.body);
  return json(r);
};

/** A tiny fake model server: records requests, replies from a script. */
function fakeServer(handler: (path: string, body: any, req: IncomingMessage) => unknown) {
  const requests: { path: string; body: any; headers: IncomingMessage['headers'] }[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ path: req.url!, body, headers: req.headers });
      const out = handler(req.url!, body, req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise<{ url: string; requests: typeof requests; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}`, requests, close: () => server.close() });
    }),
  );
}

beforeAll(async () => {
  ctx = await makeApp();
  await post('/api/finance/accounts', { name: 'Wallet', type: 'cash', openingBalance: '12,500' });
});
afterAll(async () => {
  setAiRunnerForTests(null);
  await ctx.close();
});

describe('AI is opt-in', () => {
  it('is off by default and refuses to answer', async () => {
    const s = await get('/api/ai/status');
    expect(s).toMatchObject({ enabled: false, ready: false, problem: 'disabled' });
    const r = await call(ctx, 'POST', '/api/ai/ask', { question: 'How much cash do I have?' });
    expect(r.statusCode).toBe(400);
    expect(json(r).error.code).toBe('ai_disabled');
  });
});

describe('with a local Ollama model (real HTTP path, fake server)', () => {
  let ollama: Awaited<ReturnType<typeof fakeServer>>;
  beforeAll(async () => {
    let chat = 0;
    ollama = await fakeServer((path, body) => {
      if (path === '/api/tags') return { models: [{ name: 'qwen2.5:7b', size: 1, capabilities: ['completion', 'tools'] }, { name: 'embed', size: 1, capabilities: ['embedding'] }] };
      chat++;
      // First turn: ask for net worth. Second: answer using the tool result that came back.
      if (body.messages.at(-1).role !== 'tool') return { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'net_worth', arguments: {} } }] }, prompt_eval_count: 50, eval_count: 5 };
      const data = JSON.parse(body.messages.at(-1).content);
      return { message: { role: 'assistant', content: `<think>hmm</think>Your cash is ${data.cash} ${data.currency}.` }, prompt_eval_count: 80, eval_count: 12, chat };
    });
  });
  afterAll(() => ollama.close());

  it('needs a model chosen from the installed ones', async () => {
    await patchAi({ enabled: true, provider: 'ollama', ollamaUrl: ollama.url, ollamaModel: '' });
    let s = await get('/api/ai/status');
    expect(s).toMatchObject({ ready: false, problem: 'no_model', leavesDevice: false });
    expect(s.ollama.models.map((m: any) => m.name)).toEqual(['qwen2.5:7b']); // embedding-only models are hidden
    await patchAi({ ollamaModel: 'llama-not-installed' });
    expect((await get('/api/ai/status')).problem).toBe('model_missing');
    await patchAi({ ollamaModel: 'qwen2.5:7b' });
    s = await get('/api/ai/status');
    expect(s.ready).toBe(true);
  });

  it('answers from tool results only, shows the data used, and logs the call', async () => {
    const r = await post('/api/ai/ask', { question: 'How much cash do I have?' });
    expect(r.answer).toBe('Your cash is 12500 EGP.'); // <think> removed
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({ name: 'net_worth', ok: true, result: { cash: 12500, currency: 'EGP' } });
    const chats = ollama.requests.filter((x) => x.path === '/api/chat');
    expect(chats[0].body.tools.map((t: any) => t.function.name)).toContain('net_worth');
    expect(chats[0].body.messages[0].content).toContain('Never invent');
    const log = await get('/api/ai/log');
    expect(log[0]).toMatchObject({ purpose: 'ask', provider: 'ollama', model: 'qwen2.5:7b', status: 'ok', question: 'How much cash do I have?', inputTokens: 130 });
    expect(log[0].tools[0].name).toBe('net_worth');
    expect(log[0].dataChars).toBeGreaterThan(20);
  });

  it('switched-off areas are not offered to the model', async () => {
    const before = ollama.requests.length;
    const allow = (await get('/api/settings')).ai.allow;
    await patchAi({ allow: { ...allow, finance: false } });
    await post('/api/ai/ask', { question: 'Cash?' });
    const sent = ollama.requests.slice(before).find((x) => x.path === '/api/chat')!;
    const names = sent.body.tools.map((t: any) => t.function.name);
    expect(names).not.toContain('net_worth');
    expect(names).toContain('tasks');
    const last = (await get('/api/ai/log'))[0];
    expect(last.tools[0]).toMatchObject({ name: 'net_worth', ok: false }); // the model asked anyway and was refused
    await patchAi({ allow: { ...allow, finance: true } });
  });
});

describe('with the Claude API (real HTTP path, fake server)', () => {
  let claude: Awaited<ReturnType<typeof fakeServer>>;
  beforeAll(async () => {
    claude = await fakeServer((_path, body) => {
      const last = body.messages.at(-1);
      if (typeof last.content === 'string')
        return { content: [{ type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: 'tu1', name: 'tasks', input: { view: 'open' } }], stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 10 } };
      const result = JSON.parse(last.content[0].content);
      return { content: [{ type: 'text', text: `You have ${result.count} open tasks.\n\nSuggestion: pick one.` }], stop_reason: 'end_turn', usage: { input_tokens: 150, output_tokens: 20 } };
    });
    process.env.LIFE_ERP_ANTHROPIC_URL = claude.url;
  });
  afterAll(() => {
    delete process.env.LIFE_ERP_ANTHROPIC_URL;
    claude.close();
  });

  it('needs a key and your explicit consent before anything is sent', async () => {
    await patchAi({ provider: 'anthropic', cloudConsentAt: null });
    expect((await get('/api/ai/status')).problem).toBe('no_key');
    expect((await call(ctx, 'PUT', '/api/ai/key', { key: 'short' })).statusCode).toBe(400);
    const k = json(await call(ctx, 'PUT', '/api/ai/key', { key: 'sk-ant-test-0123456789abcdef-WXYZ' }));
    expect(k).toMatchObject({ set: true, usable: true, hint: 'WXYZ' });
    expect(JSON.stringify(await get('/api/ai/status'))).not.toContain('0123456789abcdef');
    // Stored encrypted — the key text is nowhere in the database.
    const row = getSqlite().prepare("SELECT * FROM secrets WHERE name = 'anthropic_api_key'").get() as any;
    expect(JSON.stringify(row)).not.toContain('0123456789abcdef');
    const s = await get('/api/ai/status');
    expect(s).toMatchObject({ problem: 'no_consent', leavesDevice: true });
    expect(claude.requests).toHaveLength(0);
  });

  it('runs the tool loop with the stored key', async () => {
    await patchAi({ cloudConsentAt: new Date().toISOString() });
    await post('/api/tasks', { title: 'Call the bank', status: 'planned' });
    const r = await post('/api/ai/ask', { question: 'How many open tasks?', history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello' }] });
    expect(r.answer).toBe('You have 1 open tasks.\n\nSuggestion: pick one.');
    expect(r.toolCalls[0]).toMatchObject({ name: 'tasks', args: { view: 'open' }, ok: true });
    expect(claude.requests[0].headers['x-api-key']).toBe('sk-ant-test-0123456789abcdef-WXYZ');
    expect(claude.requests[0].body.messages).toHaveLength(3);
    expect(claude.requests[1].body.messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu1' });
    expect((await get('/api/ai/log'))[0]).toMatchObject({ provider: 'anthropic', inputTokens: 250, outputTokens: 30 });
  });

  it('a key from another computer (different master key) is reported as unusable', async () => {
    rmSync(join(getConfig().paths.keys, 'master.key'));
    expect((await get('/api/ai/status')).problem).toBe('key_unusable');
    expect(json(await call(ctx, 'DELETE', '/api/ai/key')).set).toBe(false);
  });
});

describe('review suggestions', () => {
  it('drafts from the period numbers and returns them for you to edit', async () => {
    // Any ready provider; the model call itself is scripted here.
    await call(ctx, 'PUT', '/api/ai/key', { key: 'sk-ant-test-0123456789abcdef-WXYZ' });
    await patchAi({ provider: 'anthropic', cloudConsentAt: new Date().toISOString() });
    let seen = '';
    setAiRunnerForTests(async (req) => {
      seen = req.turns[0].content;
      return { answer: 'Sure: {"wins": "Saved 0 EGP", "challenges": "", "lessons": "Track more", "priorities": ["Budget", "Gym"]}', toolCalls: [], inputTokens: 1, outputTokens: 1, dataChars: 0 };
    });
    const r = await post('/api/ai/review', { type: 'weekly' });
    expect(r.suggestions).toEqual({ wins: 'Saved 0 EGP', challenges: '', lessons: 'Track more', priorities: 'Budget\nGym' });
    expect(seen).toContain('"tasks"');
    expect(r.facts.period.start).toBeTruthy();
    setAiRunnerForTests(async () => ({ answer: 'no json here', toolCalls: [], inputTokens: 0, outputTokens: 0, dataChars: 0 }));
    expect((await call(ctx, 'POST', '/api/ai/review', { type: 'weekly' })).statusCode).toBe(502);
    setAiRunnerForTests(null);
  });

  it('the activity log can be cleared', async () => {
    expect((await get('/api/ai/log')).length).toBeGreaterThan(0);
    await call(ctx, 'DELETE', '/api/ai/log');
    expect(await get('/api/ai/log')).toEqual([]);
  });
});
