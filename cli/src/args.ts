import { parseArgs } from 'node:util';
import { kstDate, kstEpoch } from '../../src/lib/time/kst';
import { CliError } from './errors';

export interface Args {
  command: string;
  positionals: string[];
  profile?: string;
  provider?: 'kis' | 'toss';
  label?: string;
  server?: string;
  strategy?: string;
  envFile?: string;
  from?: string;
  to?: string;
  keep?: number;
  pretty: boolean;
  verbose: boolean;
  today: boolean;
  raw: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 달력에 있는 날짜인가(왕복 변환으로 확인. strategyV1.ts의 realDate와 같은 방식): 2026-02-29·2026-13-01은 아니고 2028-02-29는 맞다 */
const realDate = (d: string): boolean => DATE.test(d) && kstDate(kstEpoch(d, '00:00:00')) === d;
const bad = (message: string) => new CliError('invalid-args', message);

export function parseArgv(argv: string[]): Args {
  const parsed = (() => {
    try {
      return parseArgs({
        args: argv,
        allowPositionals: true,
        strict: true,
        options: {
          profile: { type: 'string' },
          provider: { type: 'string' },
          label: { type: 'string' },
          server: { type: 'string' },
          strategy: { type: 'string' },
          'env-file': { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          keep: { type: 'string' },
          pretty: { type: 'boolean' },
          verbose: { type: 'boolean' },
          today: { type: 'boolean' },
          raw: { type: 'boolean' },
        },
      });
    } catch {
      throw bad('알 수 없는 옵션이거나 값이 빠졌어요');
    }
  })();
  const v = parsed.values as Record<string, string | boolean | undefined>;
  const provider = v.provider as string | undefined;
  if (provider !== undefined && provider !== 'kis' && provider !== 'toss') throw bad('--provider는 kis 또는 toss예요');
  for (const k of ['from', 'to'] as const) {
    const d = v[k];
    if (typeof d === 'string' && !realDate(d)) throw bad(`--${k}는 달력에 있는 YYYY-MM-DD여야 해요`);
  }
  const keepRaw = v.keep as string | undefined;
  let keep: number | undefined;
  if (keepRaw !== undefined) {
    keep = Number(keepRaw);
    if (!Number.isInteger(keep) || keep < 1 || keep > 5) throw bad('--keep은 1~5 사이 정수예요');
  }
  const [command = '', ...positionals] = parsed.positionals;
  const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : undefined);
  return {
    command,
    positionals,
    ...(provider !== undefined && { provider }),
    ...(str('profile') !== undefined && { profile: str('profile') }),
    ...(str('label') !== undefined && { label: str('label') }),
    ...(str('server') !== undefined && { server: str('server') }),
    ...(str('strategy') !== undefined && { strategy: str('strategy') }),
    ...(str('env-file') !== undefined && { envFile: str('env-file') }),
    ...(str('from') !== undefined && { from: str('from') }),
    ...(str('to') !== undefined && { to: str('to') }),
    ...(keep !== undefined && { keep }),
    pretty: v.pretty === true,
    verbose: v.verbose === true,
    today: v.today === true,
    raw: v.raw === true,
  };
}
