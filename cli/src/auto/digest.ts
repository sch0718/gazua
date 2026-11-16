import { join } from 'node:path';
import { TEMPLATES } from '../../../src/lib/sim/templates';
import { kstDate, kstMinuteOfDay, kstWeekday } from '../../../src/lib/time/kst';
import { readAlertConfig } from '../alert/config';
import { sendNtfy } from '../commands/alert';
import { readJsonFile, writeJsonFile } from '../config';
import type { Ctx } from '../context';
import { NAVER, naverGet, parseDayBars, parseStockName } from '../naverMarket';
import { readAutoConfig } from './config';
import { ledgerPath, readLedgerRaw, type AutoLedger } from './ledger';

interface DigestDeps { notify?: typeof sendNtfy }
type DigestResult = { skipped: 'hours' | 'sent' | 'closed' } | { sent: boolean };
const money = (value: number) => value.toLocaleString('ko-KR');

/** ntfy 한도에 여유를 두고 줄 전체와 끝 문구를 보존한다. */
function bodyWithinLimit(lines: string[]): string {
  const ending = '투자 조언 아님', shortened = `…(줄임)\n${ending}`;
  const full = [...lines, ending].join('\n');
  if (Buffer.byteLength(full, 'utf8') <= 3500) return full;
  const kept: string[] = [];
  for (const line of lines) {
    if (Buffer.byteLength([...kept, line, shortened].join('\n'), 'utf8') > 3500) break;
    kept.push(line);
  }
  return [...kept, shortened].join('\n');
}

/** 오늘 판정한 연습 원장만 저녁에 한 번 요약한다. 원장은 변경하지 않는다. */
export async function runDigest(ctx: Ctx, deps: DigestDeps = {}): Promise<DigestResult> {
  const today = kstDate(ctx.now()), day = kstWeekday(today);
  if (day < 1 || day > 5 || kstMinuteOfDay(ctx.now()) < 930) return { skipped: 'hours' };
  const path = join(ctx.dir, 'auto-digest.json');
  if (readJsonFile<{ date: string }>(path)?.date === today) return { skipped: 'sent' };
  const cfg = readAutoConfig(ctx.env);
  const sources = [{ name: cfg.strategy, path: ledgerPath(ctx.dir, 'dry') },
    ...(cfg.dryPresets === 'all' ? TEMPLATES.map((t) => ({ name: t.name, path: ledgerPath(ctx.dir, 'dry', t.id) })) : [])];
  const ledgers = sources.map((source): { name: string; ledger: AutoLedger | null } => {
    try {
      const ledger = readLedgerRaw(source.path);
      return { name: source.name, ledger: ledger?.today.date === today && ledger.today.judgedDate === today ? ledger : null };
    } catch { return { name: source.name, ledger: null }; }
  });
  if (!ledgers.some((s) => s.ledger)) return { skipped: 'closed' };
  const alert = readAlertConfig(ctx.env);
  ctx.redact.add(alert.topic);
  const quotes = new Map<string, { name: string; close: number | null }>();
  for (const symbol of new Set(ledgers.flatMap((s) => s.ledger?.positions.map((p) => p.symbol) ?? []))) {
    let close: number | null = null, name = symbol;
    try {
      const stamp = today.replaceAll('-', '');
      const days = parseDayBars(await naverGet(ctx, NAVER.itemDay(symbol, stamp + '0000', stamp + '2359'))).filter((b) => b.date <= today);
      if (days.at(-1)?.date === today) close = days.at(-1)!.close;
    } catch { /* 오늘 종가가 없으면 평가하지 않는다. */ }
    try { name = parseStockName(await naverGet(ctx, NAVER.stockBasic(symbol))) ?? symbol; } catch { /* 이름을 못 읽으면 코드로 표시한다. */ }
    quotes.set(symbol, { name, close });
  }
  const lines: string[] = [];
  for (const { name, ledger } of ledgers) {
    if (lines.length) lines.push('');
    lines.push(name);
    if (!ledger) { lines.push('오늘 기록 없음'); continue; }
    if (!ledger.today.trades?.length) lines.push('거래 없음');
    for (const t of ledger.today.trades ?? []) lines.push(`${t.side === 'BUY' ? '매수' : '매도'} ${t.symbol} ${t.name} ${t.qty}주 ${money(t.price)}원 (${t.reason})`);
    for (const p of ledger.positions) {
      const quote = quotes.get(p.symbol)!;
      const pct = quote.close === null ? null : (quote.close / p.buyPrice - 1) * 100;
      lines.push(`${quote.name} ${p.qty}주 ${money(p.buyPrice)}→${quote.close === null ? '평가 불가' : `${money(quote.close)} ${pct! >= 0 ? '+' : ''}${pct!.toFixed(1)}%`}`);
    }
  }
  const title = `[연습] 오늘 연습 결과 ${Number(today.slice(5, 7))}/${Number(today.slice(8))}`;
  const sent = await (deps.notify ?? sendNtfy)(ctx, alert, { title, body: bodyWithinLimit(lines) });
  if (sent) writeJsonFile(path, { date: today });
  return { sent };
}
