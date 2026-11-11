import { CliError } from '../errors';

export interface AlertConfig { topic: string; server: string; spikeSigma: number; cooldownMin: number; dailyMax: number; top: number }
export function readAlertConfig(env: Record<string, string | undefined>): AlertConfig {
  const topic = env.GAZUA_ALERT_NTFY_TOPIC?.trim();
  if (!topic) throw new CliError('invalid-args', 'GAZUA_ALERT_NTFY_TOPIC이 없어요. install.sh를 실행해 주세요');
  const read = (key: string, fallback: number) => {
    const raw = env[`GAZUA_ALERT_${key}`];
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!raw.trim() || !Number.isFinite(n) || n < 0) throw new CliError('invalid-args', `GAZUA_ALERT_${key}는 0 이상의 숫자여야 해요`);
    return n;
  };
  return {
    topic,
    server: (env.GAZUA_ALERT_NTFY_SERVER?.trim() || 'https://ntfy.sh').replace(/\/+$/, ''),
    spikeSigma: read('SPIKE_SIGMA', 2.5), cooldownMin: read('COOLDOWN_MIN', 0), dailyMax: read('DAILY_MAX', 0), top: read('TOP', 5),
  };
}
