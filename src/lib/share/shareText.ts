// 공유 스냅샷의 사람이 읽는 요약(만들기 미리 보기와 읽기 화면이 함께 쓴다).
import type { UniverseItem } from '../data/universe';
import type { ShareSnapshot } from './snapshot';

/** 종목 코드 → 이름. 스냅샷에는 코드만 들어 있어 보는 쪽이 앱의 종목 목록(universe.json)으로 이름을 붙인다. */
export type SymbolNames = ReadonlyMap<string, string>;

export function symbolNames(items: readonly UniverseItem[]): SymbolNames {
  return new Map(items.map((u) => [u.s, u.n]));
}

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const on = (b: boolean) => (b ? '켬' : '끔');

/** 이름을 알면 「이름(코드)」, 모르면 코드만. */
const symbolList = (symbols: string[], names?: SymbolNames) =>
  symbols.map((c) => (names?.has(c) ? `${names.get(c)}(${c})` : c)).join(', ') || '없음';

export function snapshotLines(s: ShareSnapshot, names?: SymbolNames): string[] {
  switch (s.kind) {
    case 'group':
      return [`제목: ${s.title}`, `종목 ${s.symbols.length}개: ${symbolList(s.symbols, names)}`];
    case 'strategy': {
      const st = s.strategy;
      const symbols = st.universe.kind === 'symbols' ? st.universe.symbols : [];
      return [
        `제목: ${s.title}`,
        `종목 ${symbols.length}개: ${symbolList(symbols, names)}`,
        `기간: ${st.period.from} ~ ${st.period.to}`,
        `초기 자금: ${s.capitalHidden ? '비공개' : won(st.capital.initial)} · 1회 ${st.capital.perBuyPct}%`,
        `하락 ${st.entry.decline.dropPct.on ? `${st.entry.decline.dropPct.value}%` : '끔'} · 분할 매수 ${on(st.scaleIn.on)}`,
        `익절 ${st.exit.takeProfit.map((t) => `${t.pct}%`).join('/')} · 손절 ${st.exit.stopLoss.pct}%`,
        `수수료 ${st.costs.feePct}%`,
      ];
    }
    case 'criteria': {
      const c = s.criteria;
      return [
        `제목: ${s.title}`,
        `시장: ${c.pool.markets.join(', ')} · 종류: ${c.pool.types.join(', ')}`,
        `바구니 ${s.baskets.length}개${s.baskets.length ? `: ${s.baskets.map((b) => `${b.name}(${b.symbols.length})`).join(', ')}` : ''}`,
        `상위 ${c.rank.take}개 · 리밸런싱 ${c.rebalance}`,
        `기간: ${c.period.from} ~ ${c.period.to}`,
        `초기 자금: ${s.capitalHidden ? '비공개' : won(c.capital)}`,
      ];
    }
    case 'compare':
      return [`제목: ${s.title}`, `종목 ${s.symbols.length}개: ${symbolList(s.symbols, names)}`];
    case 'simResult':
      return [`제목: ${s.title}`, `기간: ${s.run.from} ~ ${s.run.to}`, `종목 ${s.result.symbols.length}개`];
    case 'validation':
      return [`제목: ${s.title}`, `기간: ${s.run.from} ~ ${s.run.to}`, `종목 ${s.result.today.picks.length}개`];
  }
}
