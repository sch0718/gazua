import { ApiError } from '../../../src/lib/providers/errors';
import type { Command } from '../context';
import { chooseProvider, readCreds } from '../env';
import { CliError } from '../errors';
import { buildProvider } from '../providers';

const SYMBOL = /^Q?[0-9A-Z]{6}$/;
/** 토스는 ETN을 Q 없는 6자리로 돌려준다 */
const norm = (s: string) => s.replace(/^Q(?=\d{6}$)/, '');
// 현재 앱의 토스 공급자는 시세가 하나라도 빠지면 이 오류를 던진다.
// 다른 upstream 오류(깨진 가격·응답 등)를 누락으로 숨기지 않는다.
const isMissingPrice = (e: unknown): boolean =>
  e instanceof ApiError && e.code === 'upstream' && e.status === 200 && e.message === 'Toss price response is missing a requested symbol';

export const quote: Command = async (ctx) => {
  const symbols = ctx.args.positionals;
  if (symbols.length === 0) throw new CliError('invalid-args', '종목 코드가 필요해요. 예: gazua quote 005930 000660');
  for (const s of symbols) if (!SYMBOL.test(s)) throw new CliError('invalid-args', `종목 코드 모양이 맞지 않아요: ${s}`);
  const creds = readCreds(ctx.env);
  const id = chooseProvider(creds, ctx.args.provider);
  const { provider } = buildProvider(ctx, id, creds);
  const venues = provider.capabilities.venues;
  const venue = venues.length === 0 || venues.includes('KRX') ? 'KRX' : venues[0];
  const unique = [...new Set(symbols)];
  const quotes = await provider.getQuotes(unique, venue).catch(async (e: unknown) => {
    if (!isMissingPrice(e)) throw e;
    if (unique.length === 1) return [];
    // 보통은 일괄 조회 한 번으로 끝낸다. 일부 누락일 때만 개별 조회로 받은 종목을 복구한다.
    const parts = await Promise.all(unique.map(async (symbol) => {
      try {
        return await provider.getQuotes([symbol], venue);
      } catch (e) {
        if (isMissingPrice(e)) return [];
        throw e;
      }
    }));
    return parts.flat();
  });
  const got = new Set(quotes.map((q) => norm(q.symbol)));
  const missing = unique.filter((s) => !got.has(norm(s)));
  return {
    provider: id,
    quotes: quotes.map((q) => ({ symbol: q.symbol, price: q.price, ts: q.ts, venue: q.venue })),
    ...(missing.length ? { missing } : {}),
  };
};

export const holdings: Command = async (ctx) => {
  if ((ctx.args.provider ?? 'toss') !== 'toss') throw new CliError('provider-unsupported', '보유 조회는 토스만 돼요');
  const creds = readCreds(ctx.env);
  if (!creds.toss) throw new CliError('no-credentials');
  const { provider } = buildProvider(ctx, 'toss', creds);
  const account = provider.account;
  if (!account) throw new CliError('provider-unsupported');
  ctx.redact.add(await account.accountId());
  const list = await account.holdings();
  return {
    provider: 'toss',
    holdings: list.map((h) => ({ symbol: h.symbol, name: h.name, quantity: h.quantity, ...(h.avgPrice !== undefined ? { avgPrice: h.avgPrice } : {}) })),
  };
};
