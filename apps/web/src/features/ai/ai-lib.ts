import { useQuery } from '@tanstack/react-query';
import type { AiScope } from '@life-erp/shared';
import { api } from '../../lib/api';

export interface AiStatus {
  enabled: boolean;
  provider: 'ollama' | 'anthropic';
  model: string;
  ready: boolean;
  problem: 'disabled' | 'no_key' | 'key_unusable' | 'no_consent' | 'unreachable' | 'no_model' | 'model_missing' | null;
  leavesDevice: boolean;
  key: { set: boolean; usable: boolean; hint: string | null; updatedAt: string | null; fromEnvironment: boolean };
  ollama: { models: { name: string; tools: boolean; size: number }[]; error: string | null } | null;
  allow: Record<AiScope, boolean>;
}

export interface ToolCall {
  name: string;
  args: unknown;
  ok: boolean;
  result: unknown;
}

export const AI_KEYS = [['ai'], ['settings'], ['audit']];

export function useAiStatus() {
  return useQuery({ queryKey: ['ai', 'status'], queryFn: () => api.get<AiStatus>('/api/ai/status'), staleTime: 15_000 });
}
