import { CliError } from '../errors';

export interface AutoConfig {
  strategy: string;
  profile?: string;
  mode: 'dry' | 'live';
  buySlipPct: number;
  sellSlipPct: number;
}

export function readAutoConfig(env: Record<string, string | undefined>): AutoConfig {
  const keys = new Set(['AUTO_STRATEGY', 'AUTO_PROFILE', 'AUTO_MODE', 'AUTO_BUY_SLIPPAGE_PCT', 'AUTO_SELL_SLIPPAGE_PCT', 'AUTO_INTERVAL_MIN']);
  for (const key of Object.keys(env)) {
    if (key.startsWith('AUTO_') && !keys.has(key)) throw new CliError('invalid-args', `알 수 없는 자동 실행 설정이에요: ${key}`);
  }
  const strategy = env.AUTO_STRATEGY?.trim();
  if (!strategy) throw new CliError('invalid-args', 'AUTO_STRATEGY가 필요해요');
  const mode = env.AUTO_MODE?.trim() ?? 'dry';
  if (mode !== 'dry' && mode !== 'live') throw new CliError('invalid-args', 'AUTO_MODE는 dry 또는 live여야 해요');
  const pct = (key: string, fallback: number, max: number): number => {
    const raw = env[key];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!raw.trim() || !Number.isFinite(value) || value < 0 || value > max) throw new CliError('invalid-args', `${key}는 0~${max} 사이 숫자여야 해요`);
    return value;
  };
  const profile = env.AUTO_PROFILE?.trim();
  return { strategy, ...(profile ? { profile } : {}), mode, buySlipPct: pct('AUTO_BUY_SLIPPAGE_PCT', 1, 5), sellSlipPct: pct('AUTO_SELL_SLIPPAGE_PCT', 2, 10) };
}
