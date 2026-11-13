import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { UPSTREAM } from '../src/allowlist.js';

export interface OrderConfig {
  enabled: boolean;
  /** 1회 금액 상한(이 금액 이상 거절). 없으면 총 가용 금액만 본다. */
  maxAmount?: number;
  dailyMaxAmount?: number;
  /** 보낸 매수 − 매도 잔액의 상한(총 가용 금액). 없으면 검사하지 않는다. */
  totalMaxAmount?: number;
  maxPerMinute: number;
  maxPerDay: number;
  stopFile: string;
  auditLog: string;
  disabledReason?: string;
}

export type OrderHandler = (req: Request) => Promise<Response>;
interface Dependencies {
  fetchImpl: typeof fetch;
  now: () => number;
  upstreamTimeoutMs: number;
  randomId?: () => string;
}
interface Order {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  amount: number;
}

const ORDER_KEYS = ['ORDER_ENABLED', 'ORDER_MAX_AMOUNT', 'ORDER_DAILY_MAX_AMOUNT', 'ORDER_TOTAL_MAX_AMOUNT', 'ORDER_MAX_PER_MINUTE', 'ORDER_MAX_PER_DAY', 'ORDER_STOP_FILE', 'ORDER_AUDIT_LOG'];
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const timestamp = (now: number) => new Date(now + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
const dayOf = (now: number) => timestamp(now).slice(0, 10);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** 선택 설정의 오타도 기본값으로 숨기지 않고 주문 전체를 끈다. */
export function readOrderConfig(env: Record<string, string | undefined>, home = homedir()): OrderConfig {
  let reason = env.ORDER_ENABLED === 'true' ? undefined : 'ORDER_ENABLED가 true가 아니에요';
  const integer = (name: string, fallback?: number): number => {
    const raw = env[name];
    if (raw === undefined && fallback !== undefined) return fallback;
    const n = Number(raw);
    if (raw !== undefined && /^[1-9]\d*$/.test(raw) && positive(n)) return n;
    reason = `${name}는 양의 안전한 정수여야 해요`;
    return fallback ?? 0;
  };
  const maxAmount = env.ORDER_MAX_AMOUNT === undefined ? undefined : integer('ORDER_MAX_AMOUNT');
  const dailyMaxAmount = env.ORDER_DAILY_MAX_AMOUNT === undefined || env.ORDER_DAILY_MAX_AMOUNT === '' ? undefined : integer('ORDER_DAILY_MAX_AMOUNT');
  const totalMaxAmount = env.ORDER_TOTAL_MAX_AMOUNT === undefined || env.ORDER_TOTAL_MAX_AMOUNT === '' ? undefined : integer('ORDER_TOTAL_MAX_AMOUNT');
  // 금액 상한이 하나도 없으면 켜지 않는다. 1회 한도가 없으면 총 가용 금액이 한 번에 쓸 수 있는 최대다.
  if (maxAmount === undefined && totalMaxAmount === undefined) reason ??= 'ORDER_MAX_AMOUNT나 ORDER_TOTAL_MAX_AMOUNT 중 하나는 있어야 해요';
  const maxPerMinute = integer('ORDER_MAX_PER_MINUTE', 3);
  const maxPerDay = integer('ORDER_MAX_PER_DAY', 20);
  // 키 이름 오타는 그 설정이 조용히 빠지는 것이므로 주문을 끈다.
  const unknownKey = Object.keys(env).find((key) => key.toUpperCase().startsWith('ORDER_') && !ORDER_KEYS.includes(key));
  if (unknownKey) reason = `알 수 없는 설정 ${unknownKey}가 있어요(오타인지 확인해 주세요)`;
  const expand = (name: string, fallback: string) => {
    const path = env[name] || fallback;
    if (path === '~') return home;
    if (path.startsWith('~/')) return join(home, path.slice(2));
    // launchd의 작업 폴더는 /라서 상대 경로는 엉뚱한 곳을 본다.
    if (!isAbsolute(path)) reason = `${name}는 절대 경로나 ~/로 시작해야 해요`;
    return path;
  };
  const stopFile = expand('ORDER_STOP_FILE', '~/gazua-order.stop');
  const auditLog = expand('ORDER_AUDIT_LOG', '~/Library/Logs/gazua-orders.jsonl');
  return {
    enabled: reason === undefined, maxAmount, dailyMaxAmount, totalMaxAmount, maxPerMinute, maxPerDay,
    stopFile, auditLog,
    ...(reason !== undefined && { disabledReason: reason }),
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function stopped(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (e) {
    // 중지 파일 상태를 확인하지 못할 때도 보내지 않는다.
    return !object(e) || e.code !== 'ENOENT';
  }
}

async function parseOrder(req: Request): Promise<Order | undefined> {
  if (!req.headers.get('authorization') || !req.headers.get('x-tossinvest-account')) return;
  let value: unknown;
  try { value = await req.json(); } catch { return; }
  if (!object(value) || Object.keys(value).some((key) => !['symbol', 'side', 'quantity', 'price'].includes(key))) return;
  const { symbol, side, quantity, price } = value;
  if (typeof symbol !== 'string' || !/^[0-9A-Z]{6}$/.test(symbol) || (side !== 'BUY' && side !== 'SELL')) return;
  if (!positive(quantity) || !positive(price) || !positive(quantity * price)) return;
  return { symbol, side, quantity, price, amount: quantity * price };
}

/** 복원은 비동기로 시작하지만 준비 전 요청을 기다리게 하지 않는다. */
export function createOrderHandler(cfg: OrderConfig, deps: Dependencies): { handler: OrderHandler; ready: Promise<void> } {
  let prepared = false;
  let busy = false;
  let day = dayOf(deps.now());
  let count = 0;
  let amount = 0;
  // 보낸 매수 − 매도 잔액. 원래 갖고 있던 주식을 팔아 한도가 늘지 않게 0 아래로 내려가지 않는다.
  let invested = 0;
  const spend = (order: Pick<Order, 'side' | 'amount'>) => { invested = Math.max(0, invested + (order.side === 'BUY' ? order.amount : -order.amount)); };
  let recent: number[] = [];
  const refresh = (now: number) => {
    if (day !== dayOf(now)) { day = dayOf(now); count = 0; amount = 0; }
    recent = recent.filter((ts) => now - ts < 60_000);
  };
  const audit = (event: Record<string, unknown>) => {
    const now = deps.now();
    return appendFile(cfg.auditLog, JSON.stringify({ ts: timestamp(now), day: dayOf(now), ...event }) + '\n', { mode: 0o600 });
  };
  const bestEffort = async (event: Record<string, unknown>) => { try { await audit(event); } catch { /* 결과와 거절 로그 실패는 응답을 막지 않는다. */ } };
  const reject = async (status: number, code: string, order?: Order, data?: unknown) => {
    await bestEffort({ event: 'reject', code, ...order });
    return json(status, { error: { code, ...(data !== undefined && { data }) } });
  };

  const ready = (async () => {
    // 설정으로 꺼져 있으면 감사 로그 파일도 건드리지 않는다.
    if (!cfg.enabled) return;
    try {
      await mkdir(dirname(cfg.auditLog), { recursive: true });
      const file = await open(cfg.auditLog, 'a', 0o600);
      try { await file.chmod(0o600); } finally { await file.close(); }
      const raw = await readFile(cfg.auditLog, 'utf8');
      const now = deps.now();
      day = dayOf(now);
      const lines = raw.split('\n');
      for (const [index, line] of lines.entries()) {
        if (index === lines.length - 1 && line === '') continue;
        try {
          const entry: unknown = JSON.parse(line);
          if (!object(entry)) throw new Error();
          if (entry.event !== 'send') continue;
          const { side, quantity, price, amount: sentAmount, ts } = entry;
          if ((side !== 'BUY' && side !== 'SELL') || !positive(quantity) || !positive(price) || !positive(sentAmount) || quantity * price !== sentAmount) throw new Error();
          const sent = typeof ts === 'string' ? Date.parse(ts) : NaN;
          if (!Number.isFinite(sent) || sent > now || (entry.day !== undefined && entry.day !== dayOf(sent))) throw new Error();
          if (dayOf(sent) === day) {
            if (!Number.isSafeInteger(amount + sentAmount) || !Number.isSafeInteger(count + 1)) throw new Error();
            count++;
            amount += sentAmount;
          }
          if (!Number.isSafeInteger(invested + sentAmount)) throw new Error();
          spend({ side, amount: sentAmount });
          if (now - sent < 60_000) recent.push(sent);
        } catch { throw new Error(`감사 로그 ${index + 1}번째 줄을 확인해 주세요`); }
      }
      // 마지막 JSON에 개행이 없어도 다음 기록과 이어 붙지 않게 한다.
      if (raw.length > 0 && !raw.endsWith('\n')) await appendFile(cfg.auditLog, '\n', { mode: 0o600 });
      prepared = true;
    } catch (e) {
      cfg.enabled = false;
      cfg.disabledReason = e instanceof Error && e.message.startsWith('감사 로그 ') ? e.message : '감사 로그를 열거나 복원할 수 없어요';
    }
  })();

  const send = async (req: Request): Promise<Response> => {
    if (!prepared || !cfg.enabled) return json(403, { error: { code: 'order-disabled' } });
    if (await stopped(cfg.stopFile)) return reject(403, 'order-stopped');
    const order = await parseOrder(req);
    if (!order) return reject(400, 'order-invalid');
    const now = deps.now();
    refresh(now);
    if (cfg.maxAmount !== undefined && order.amount >= cfg.maxAmount) return reject(403, 'order-over-limit', order, { amount: order.amount, maxAmount: cfg.maxAmount });
    if (!Number.isSafeInteger(amount + order.amount) || (cfg.dailyMaxAmount !== undefined && amount + order.amount > cfg.dailyMaxAmount)) {
      return reject(403, 'order-daily-limit', order, { amount: order.amount, usedToday: amount, dailyMaxAmount: cfg.dailyMaxAmount ?? null });
    }
    if (order.side === 'BUY' && (!Number.isSafeInteger(invested + order.amount) || (cfg.totalMaxAmount !== undefined && invested + order.amount > cfg.totalMaxAmount))) {
      return reject(403, 'order-total-limit', order, { amount: order.amount, invested, totalMaxAmount: cfg.totalMaxAmount ?? null });
    }
    if (recent.length >= cfg.maxPerMinute || count >= cfg.maxPerDay) return reject(429, 'order-rate-limited', order);
    const clientOrderId = (deps.randomId ?? randomUUID)();
    try { await audit({ event: 'send', clientOrderId, ...order }); }
    catch { return json(503, { error: { code: 'order-audit-failed' } }); }
    count++;
    amount += order.amount;
    spend(order);
    recent.push(now);
    const signal = AbortSignal.timeout(deps.upstreamTimeoutMs);
    let upstream: Response;
    try {
      upstream = await deps.fetchImpl(`${UPSTREAM.toss}/api/v1/orders`, {
        method: 'POST', redirect: 'manual', signal,
        headers: { authorization: req.headers.get('authorization')!, 'x-tossinvest-account': req.headers.get('x-tossinvest-account')!, 'content-type': 'application/json' },
        body: JSON.stringify({ clientOrderId, symbol: order.symbol, side: order.side, orderType: 'LIMIT', timeInForce: 'DAY', quantity: String(order.quantity), price: String(order.price) }),
      });
      let payload: unknown;
      try { payload = await upstream.json(); }
      catch (e) {
        // JSON 문법 오류만 깨진 응답으로 보고, 본문 전송 오류는 바깥에서 분류한다.
        if (!(e instanceof SyntaxError)) throw e;
      }
      const result = object(payload) && object(payload.result) ? payload.result : undefined;
      if (upstream.status === 200 && typeof result?.orderId === 'string' && result.orderId) {
        await bestEffort({ event: 'result', clientOrderId, status: 200, orderId: result.orderId });
        return json(200, { ok: true, orderId: result.orderId, clientOrderId, amount: order.amount });
      }
      const error = object(payload) && object(payload.error) ? payload.error : undefined;
      const tossCode = typeof error?.code === 'string' ? error.code : undefined;
      const message = typeof error?.message === 'string' ? error.message : undefined;
      await bestEffort({ event: 'result', clientOrderId, status: upstream.status, ...(tossCode && { tossCode }) });
      // 4xx만 「토스가 거절함」이다. 2xx·3xx·5xx는 주문이 들어갔을 수 있으므로 502(결과 불명)로 돌려준다.
      // 3xx는 Location을 따라가지 않는다.
      if (upstream.status >= 400 && upstream.status < 500) {
        return json(upstream.status, { error: { code: 'order-upstream', status: upstream.status, tossCode, message, data: { clientOrderId } } });
      }
      return json(502, { error: { code: 'upstream-unreachable', status: upstream.status, tossCode, data: { clientOrderId } } });
    } catch {
      const status = signal.aborted ? 504 : 502;
      await bestEffort({ event: 'result', clientOrderId, status });
      return json(status, { error: { code: signal.aborted ? 'upstream-timeout' : 'upstream-unreachable', data: { clientOrderId } } });
    }
  };

  const handler: OrderHandler = async (req) => {
    const path = new URL(req.url).pathname;
    if (path === '/order/status') {
      if (req.method !== 'GET') return json(405, { error: { code: 'method-not-allowed' } });
      refresh(deps.now());
      return json(200, { enabled: prepared && cfg.enabled, stopped: await stopped(cfg.stopFile), maxAmount: cfg.maxAmount ?? null,
        dailyMaxAmount: cfg.dailyMaxAmount ?? null, totalMaxAmount: cfg.totalMaxAmount ?? null, invested, maxPerMinute: cfg.maxPerMinute, maxPerDay: cfg.maxPerDay, usedToday: { count, amount } });
    }
    if (path !== '/order/toss') return json(404, { error: { code: 'order-not-found' } });
    if (req.method !== 'POST') return json(405, { error: { code: 'method-not-allowed' } });
    if (busy) return json(409, { error: { code: 'order-busy' } });
    busy = true;
    try { return await send(req); } finally { busy = false; }
  };
  return { handler, ready };
}
