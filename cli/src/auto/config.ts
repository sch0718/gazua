import { CliError } from '../errors';

export interface AutoConfig {
  strategy: string;
  profile?: string;
  mode: 'dry' | 'live';
  dryPresets: 'all' | 'off';
  dayCloseMin?: number;
  buySlipPct: number;
  sellSlipPct: number;
}

export function readAutoConfig(env: Record<string, string | undefined>): AutoConfig {
  const keys = new Set(['AUTO_STRATEGY', 'AUTO_PROFILE', 'AUTO_MODE', 'AUTO_DRY_PRESETS', 'AUTO_DAY_CLOSE_AT', 'AUTO_BUY_SLIPPAGE_PCT', 'AUTO_SELL_SLIPPAGE_PCT', 'AUTO_INTERVAL_MIN']);
  for (const key of Object.keys(env)) {
    if (key.startsWith('AUTO_') && !keys.has(key)) throw new CliError('invalid-args', `알 수 없는 자동 실행 설정이에요: ${key}`);
  }
  const strategy = env.AUTO_STRATEGY?.trim();
  if (!strategy) throw new CliError('invalid-args', 'AUTO_STRATEGY가 필요해요');
  const mode = env.AUTO_MODE?.trim() ?? 'dry';
  if (mode !== 'dry' && mode !== 'live') throw new CliError('invalid-args', 'AUTO_MODE는 dry 또는 live여야 해요');
  const dryPresets = env.AUTO_DRY_PRESETS?.trim() ?? 'off';
  if (dryPresets !== 'all' && dryPresets !== 'off') throw new CliError('invalid-args', 'AUTO_DRY_PRESETS는 all 또는 off여야 해요');
  const dayCloseAt = env.AUTO_DAY_CLOSE_AT?.trim() ?? 'off';
  if (dayCloseAt !== 'off' && !/^15:(?:0[0-9]|10)$/.test(dayCloseAt)) {
    throw new CliError('invalid-args', 'AUTO_DAY_CLOSE_AT은 off 또는 15:00~15:10 사이의 HH:MM이어야 해요');
  }
  const pct = (key: string, fallback: number, max: number): number => {
    const raw = env[key];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!raw.trim() || !Number.isFinite(value) || value < 0 || value > max) throw new CliError('invalid-args', `${key}는 0~${max} 사이 숫자여야 해요`);
    return value;
  };
  const profile = env.AUTO_PROFILE?.trim();
  return {
    strategy, ...(profile ? { profile } : {}), mode, dryPresets,
    ...(dayCloseAt === 'off' ? {} : { dayCloseMin: 15 * 60 + Number(dayCloseAt.slice(3)) }),
    buySlipPct: pct('AUTO_BUY_SLIPPAGE_PCT', 1, 5), sellSlipPct: pct('AUTO_SELL_SLIPPAGE_PCT', 2, 10),
  };
}
