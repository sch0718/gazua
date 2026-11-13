import type { Command, Ctx } from '../context';
import { readCreds } from '../env';
import { CliError, MESSAGES, type CliErrorCode } from '../errors';
import { buildProvider, proxyOf } from '../providers';

type Row = Record<string, unknown>;
const record = (v: unknown): v is Row => v !== null && typeof v === 'object' && !Array.isArray(v);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const nonnegative = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** 주문 오류만 명시적으로 통과시킨다. 모르는 실패를 안전한 재전송으로 오해하지 않게 한다. */
const PROXY_ERRORS: Record<string, CliErrorCode> = {
  'toss-token-failed': 'order-token-failed',
  'order-not-configured': 'order-not-configured', 'order-disabled': 'order-disabled', 'order-stopped': 'order-stopped',
  'order-over-limit': 'order-over-limit', 'order-daily-limit': 'order-daily-limit', 'order-total-limit': 'order-total-limit', 'order-rate-limited': 'order-rate-limited',
  'order-busy': 'order-busy', 'order-invalid': 'order-invalid', 'order-unavailable': 'order-unavailable',
  'order-upstream': 'order-upstream', 'order-unknown': 'order-unknown', 'order-audit-failed': 'order-audit-failed',
  'proxy-token-invalid': 'proxy-rejected', 'origin-not-allowed': 'proxy-rejected',
};

function unknownOrder(data?: unknown): CliError {
  const hasId = record(data) && typeof data.clientOrderId === 'string' && data.clientOrderId !== '';
  const hint = hasId ? '' : '. 맥 감사 로그의 send 줄에서 시각·종목으로 clientOrderId를 찾아 주세요';
  return new CliError('order-unknown', MESSAGES['order-unknown'] + hint, data);
}

function proxyError(payload: unknown, sent: boolean): CliError {
  const error = record(payload) && record(payload.error) ? payload.error : {};
  const code = typeof error.code === 'string' && Object.hasOwn(PROXY_ERRORS, error.code) ? PROXY_ERRORS[error.code] : undefined;
  if (!code) return sent ? unknownOrder(error.data) : new CliError('upstream');
  if (code === 'order-unknown') return unknownOrder(error.data);
  let message: string = MESSAGES[code];
  if (code === 'order-over-limit' && record(error.data) && positive(error.data.maxAmount) && positive(error.data.amount)) {
    message = `1회 최대 금액(${error.data.maxAmount}원) 이상이라 보낼 수 없어요(이번 ${error.data.amount}원)`;
  }
  if (code === 'order-upstream' && typeof error.message === 'string') message += `. ${error.message}`;
  return new CliError(code, message, error.data);
}

async function proxyCall(ctx: Ctx, url: string, init: RequestInit, sent = false): Promise<unknown> {
  let res: Response;
  try { res = await ctx.fetch(url, { ...init, redirect: 'manual' }); }
  catch { throw sent ? unknownOrder() : new CliError('upstream'); }
  let payload: unknown;
  try { payload = await res.json(); }
  catch { throw sent ? unknownOrder() : new CliError('upstream'); }
  if ([502, 504].includes(res.status) && record(payload) && record(payload.error) && payload.error.code === 'toss-token-failed') {
    throw proxyError(payload, sent);
  }
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400) || (sent && [502, 504].includes(res.status))) {
    const error = record(payload) && record(payload.error) ? payload.error : {};
    throw sent ? unknownOrder(error.data) : new CliError('upstream');
  }
  if (res.status !== 200) throw proxyError(payload, sent);
  return payload;
}

function parseOrder(args: string[]) {
  const [side, symbol, q, p] = args;
  const quantity = Number(q);
  const price = Number(p);
  if (args.length !== 4 || (side !== 'buy' && side !== 'sell') || !/^\d{6}$/.test(symbol ?? '') ||
    !/^[1-9]\d*$/.test(q ?? '') || !/^[1-9]\d*$/.test(p ?? '') || !positive(quantity) || !positive(price) || !positive(quantity * price)) {
    throw new CliError('invalid-args', 'order buy|sell <6자리 종목> <양의 정수 수량> <양의 정수 지정가>로 입력해 주세요');
  }
  return { side: side === 'buy' ? 'BUY' : 'SELL', symbol, quantity, price };
}

function limitsOf(value: unknown) {
  if (!record(value) || typeof value.enabled !== 'boolean' || typeof value.stopped !== 'boolean' || !(value.maxAmount === null || nonnegative(value.maxAmount)) ||
    !(value.dailyMaxAmount === null || positive(value.dailyMaxAmount) || (value.enabled === false && value.dailyMaxAmount === 0)) || !positive(value.maxPerMinute) || !positive(value.maxPerDay) ||
    !(value.totalMaxAmount === undefined || value.totalMaxAmount === null || positive(value.totalMaxAmount)) || !(value.invested === undefined || nonnegative(value.invested)) ||
    !record(value.usedToday) || !nonnegative(value.usedToday.count) || !nonnegative(value.usedToday.amount)) throw new CliError('upstream');
  return { enabled: value.enabled, stopped: value.stopped, maxAmount: value.maxAmount, dailyMaxAmount: value.dailyMaxAmount,
    totalMaxAmount: value.totalMaxAmount ?? null, invested: value.invested ?? 0,
    maxPerMinute: value.maxPerMinute, maxPerDay: value.maxPerDay, usedToday: { count: value.usedToday.count, amount: value.usedToday.amount } };
}

export function proxySettings(ctx: Ctx) {
  const proxy = proxyOf(ctx);
  if (!proxy) throw new CliError('order-not-configured');
  return { server: proxy.server, headers: proxy.headers };
}

export type ProxySettings = ReturnType<typeof proxySettings>;

export async function orderStatus(ctx: Ctx, s: ProxySettings) {
  return limitsOf(await proxyCall(ctx, `${s.server}/order/status`, { headers: s.headers }));
}

export async function tossAccount(ctx: Ctx) {
  const account = buildProvider(ctx, 'toss', readCreds(ctx.env)).provider.account;
  if (!account?.orderHeaders) throw new CliError('provider-unsupported');
  const credentials = await account.orderHeaders();
  if (credentials.authorization) {
    ctx.redact.add(credentials.authorization);
    ctx.redact.add(credentials.authorization.replace(/^Bearer\s+/i, ''));
  }
  ctx.redact.add(credentials['x-tossinvest-account']);
  return { account, credentials };
}

export async function sendOrder(ctx: Ctx, s: ProxySettings, credentials: Awaited<ReturnType<typeof tossAccount>>['credentials'],
  input: { side: string; symbol: string; quantity: number; price: number }) {
  const result = await proxyCall(ctx, `${s.server}/order/toss`, { method: 'POST', headers: { ...s.headers, ...credentials, 'content-type': 'application/json' }, body: JSON.stringify(input) }, true);
  if (!record(result) || result.ok !== true || typeof result.orderId !== 'string' || !result.orderId || typeof result.clientOrderId !== 'string' || !result.clientOrderId || !positive(result.amount)) {
    throw unknownOrder(record(result) && typeof result.clientOrderId === 'string' ? { clientOrderId: result.clientOrderId } : undefined);
  }
  return { orderId: result.orderId, clientOrderId: result.clientOrderId, amount: result.amount };
}

export const order: Command = async (ctx) => {
  const input = parseOrder(ctx.args.positionals);
  const s = proxySettings(ctx);
  const limits = await orderStatus(ctx, s);
  const amount = input.quantity * input.price;
  if (!ctx.args.yes) return { sent: false, order: { ...input, amount }, limits,
    hint: '보내려면 --yes를 붙여요' + (!limits.enabled ? '. 맥 프록시에서 주문이 꺼져 있어 거절돼요'
      : limits.stopped ? '. 중지 파일이 있어 거절돼요' : limits.maxAmount !== null && amount >= limits.maxAmount ? '. 한도 이상이라 프록시가 거절해요'
      : input.side === 'BUY' && limits.totalMaxAmount !== null && limits.invested + amount > limits.totalMaxAmount ? '. 총 가용 금액을 넘어 프록시가 거절해요' : '') };
  if (ctx.args.provider !== undefined && ctx.args.provider !== 'toss') throw new CliError('provider-unsupported');
  const { credentials } = await tossAccount(ctx);
  return { sent: true, ...await sendOrder(ctx, s, credentials, input) };
};
