import { AppError } from '../../lib/errors';
import type { AiTool } from './tools';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolCallRecord {
  name: string;
  args: unknown;
  ok: boolean;
  result: unknown;
}

export interface ChatResult {
  answer: string;
  toolCalls: ToolCallRecord[];
  inputTokens: number | null;
  outputTokens: number | null;
  /** Characters of tool results (your data) sent to the model. */
  dataChars: number;
}

export interface ChatRequest {
  system: string;
  turns: ChatTurn[];
  tools: AiTool[];
  runTool: (name: string, args: unknown) => { ok: boolean; result: unknown };
  maxRounds?: number;
  timeoutMs?: number;
}

const MAX_RESULT_CHARS = 12_000;

/** Serialise a tool result for the model, capped so one tool can't flood the context. */
export function serialise(result: unknown) {
  const s = JSON.stringify(result);
  return s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}… (truncated)` : s;
}

async function post(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number, label: string) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    throw new AppError(502, 'ai_unreachable', aborted ? `${label} took too long to answer` : `Cannot reach ${label}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } | string })?.error;
    const detail = typeof msg === 'string' ? msg : (msg?.message ?? text.slice(0, 200));
    throw new AppError(502, 'ai_error', `${label} answered ${res.status}: ${detail}`);
  }
  return data as Record<string, unknown>;
}

// ---------- Anthropic (Claude API) ----------

type AnthropicBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown } | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export async function anthropicChat(req: ChatRequest, cfg: { apiKey: string; model: string; baseUrl?: string }): Promise<ChatResult> {
  const url = `${cfg.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`;
  const messages: { role: 'user' | 'assistant'; content: string | AnthropicBlock[] }[] = req.turns.map((t) => ({ role: t.role, content: t.content }));
  const tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const out: ChatResult = { answer: '', toolCalls: [], inputTokens: 0, outputTokens: 0, dataChars: 0 };
  for (let round = 0; round <= (req.maxRounds ?? 6); round++) {
    const data = (await post(
      url,
      { model: cfg.model, max_tokens: 2000, system: req.system, messages, ...(tools.length && round < (req.maxRounds ?? 6) ? { tools } : {}) },
      { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
      req.timeoutMs ?? 90_000,
      'Claude API',
    )) as { content: AnthropicBlock[]; stop_reason: string; usage?: { input_tokens?: number; output_tokens?: number } };
    out.inputTokens! += data.usage?.input_tokens ?? 0;
    out.outputTokens! += data.usage?.output_tokens ?? 0;
    const uses = data.content.filter((b): b is Extract<AnthropicBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    const text = data.content
      .filter((b): b is Extract<AnthropicBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!uses.length || data.stop_reason !== 'tool_use') {
      out.answer = text;
      return out;
    }
    messages.push({ role: 'assistant', content: data.content });
    const results: AnthropicBlock[] = uses.map((u) => {
      const r = req.runTool(u.name, u.input);
      out.toolCalls.push({ name: u.name, args: u.input, ...r });
      const content = serialise(r.result);
      out.dataChars += content.length;
      return { type: 'tool_result', tool_use_id: u.id, content, is_error: !r.ok || undefined };
    });
    messages.push({ role: 'user', content: results });
  }
  throw new AppError(502, 'ai_error', 'The assistant kept asking for more data without answering');
}

// ---------- Ollama (local) ----------

type OllamaMsg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: { function: { name: string; arguments: unknown } }[]; tool_name?: string };

export async function ollamaChat(req: ChatRequest, cfg: { url: string; model: string }): Promise<ChatResult> {
  const url = `${cfg.url.replace(/\/$/, '')}/api/chat`;
  const messages: OllamaMsg[] = [{ role: 'system', content: req.system }, ...req.turns.map((t) => ({ role: t.role, content: t.content }))];
  const tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const out: ChatResult = { answer: '', toolCalls: [], inputTokens: 0, outputTokens: 0, dataChars: 0 };
  for (let round = 0; round <= (req.maxRounds ?? 6); round++) {
    const data = (await post(
      url,
      { model: cfg.model, messages, stream: false, options: { temperature: 0.2 }, ...(tools.length && round < (req.maxRounds ?? 6) ? { tools } : {}) },
      {},
      req.timeoutMs ?? 180_000,
      'Ollama',
    )) as { message: OllamaMsg; prompt_eval_count?: number; eval_count?: number };
    out.inputTokens! += data.prompt_eval_count ?? 0;
    out.outputTokens! += data.eval_count ?? 0;
    const calls = data.message?.tool_calls ?? [];
    if (!calls.length) {
      // Some local models wrap their reasoning in <think>…</think>; it is not part of the answer.
      out.answer = (data.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      return out;
    }
    messages.push({ role: 'assistant', content: data.message.content ?? '', tool_calls: calls });
    for (const c of calls) {
      let args = c.function.arguments;
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      const r = req.runTool(c.function.name, args);
      out.toolCalls.push({ name: c.function.name, args, ...r });
      const content = serialise(r.result);
      out.dataChars += content.length;
      messages.push({ role: 'tool', content, tool_name: c.function.name });
    }
  }
  throw new AppError(502, 'ai_error', 'The assistant kept asking for more data without answering');
}

/** Installed Ollama models (and whether they can use tools), or an error message. */
export async function ollamaModels(url: string): Promise<{ models: { name: string; tools: boolean; size: number }[]; error: string | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/tags`, { signal: ctl.signal });
    if (!res.ok) return { models: [], error: `Ollama answered ${res.status}` };
    const data = (await res.json()) as { models?: { name: string; size: number; capabilities?: string[] }[] };
    return {
      models: (data.models ?? [])
        .filter((m) => !m.capabilities || m.capabilities.includes('completion'))
        .map((m) => ({ name: m.name, size: m.size, tools: !m.capabilities || m.capabilities.includes('tools') })),
      error: null,
    };
  } catch {
    return { models: [], error: `Cannot reach Ollama at ${url}. Is it running?` };
  } finally {
    clearTimeout(timer);
  }
}
