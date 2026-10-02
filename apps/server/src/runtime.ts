import type { AppConfig } from './config';

let current: AppConfig | null = null;

/** The active configuration (data paths, demo flag, …) for this process. */
export function setRuntimeConfig(c: AppConfig) {
  current = c;
}

export function getConfig(): AppConfig {
  if (!current) throw new Error('Runtime config not initialised');
  return current;
}
