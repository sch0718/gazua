// 공유 스냅샷의 사람이 읽는 요약(만들기 미리 보기·읽기 화면·카카오 카드가 함께 쓴다).
import type { UniverseItem } from '../data/universe';
import { METRICS } from '../data/metricRegistry';
import type { Settings } from '../state/schema';
import { kstDate } from '../time/kst';
import { kstHHMM, periodLabel } from '../ui/compare/compareText';
import { trendPp } from '../ui/screen/screenText';
import { dotDate, fmtReturnPct, trendReturn } from '../ui/simulate/simText';
import type { CompareSnapshot, ShareSnapshot } from './snapshot';

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

const BENCH = { AUTO: '자동', KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ' } as const;
const ORDER = { value: '값 순', mine: '내 순서' } as const;
// 「매월 재선정」 문형에 맞춰 rebalanceLabel의 명사형(분기·반기) 대신 주기 표현을 쓴다.
const REBAL = { monthly: '매월', quarterly: '매 분기', semiannual: '반기마다' } as const;

export const metricLabel = (id: Settings['metric']): string => METRICS.find((m) => m.id === id)?.label ?? id;

/** `기간 1개월 · 지표 등락률 · 벤치마크 자동 · 정렬 값 순` */
export function compareViewText(v: CompareSnapshot['view']): string {
  return `기간 ${periodLabel(v.period)} · 지표 ${metricLabel(v.metric)} · 벤치마크 ${BENCH[v.benchmark]} · 정렬 ${ORDER[v.boardOrder]}`;
}

const nameOnly = (c: string, names?: SymbolNames) => names?.get(c) ?? c;
const firstNames = (symbols: string[], names?: SymbolNames, k = 3) => symbols.slice(0, k).map((c) => nameOnly(c, names)).join(', ');
const ym = (d: string) => d.slice(0, 7).replace('-', '.');

/** 카카오 카드 설명 두 줄(설계 4.5). line은 비교 화면 캡처가 준 둘째 줄 후보 */
export function cardLines(s: ShareSnapshot, names?: SymbolNames, line: string | null = null): string[] {
  switch (s.kind) {
    case 'group': {
      const n = s.symbols.length;
      if (n === 0) return ['종목 0개'];
      return [`종목 ${n}개: ${firstNames(s.symbols, names)}${n > 3 ? ` 외 ${n - 3}개` : ''}`];
    }
    case 'strategy': {
      const st = s.strategy;
      const n = st.universe.kind === 'symbols' ? st.universe.symbols.length : 0;
      const drop = st.entry.decline.dropPct.on ? `${st.entry.decline.dropPct.value}%` : '끔';
      return [
        `종목 ${n}개 · ${dotDate(st.period.from)} ~ ${dotDate(st.period.to)}`,
        `하락 ${drop} · 익절 ${st.exit.takeProfit.map((t) => `${t.pct}%`).join('/')} · 손절 ${st.exit.stopLoss.pct}%`,
      ];
    }
    case 'criteria': {
      const c = s.criteria;
      return [`${c.pool.markets.join('·')} 상위 ${c.rank.take}개 · ${REBAL[c.rebalance]} 재선정`, `${dotDate(c.period.from)} ~ ${dotDate(c.period.to)}`];
    }
    case 'compare':
      return [`종목 ${s.symbols.length}개 · ${periodLabel(s.view.period)} ${metricLabel(s.view.metric)}`, line ?? firstNames(s.symbols, names)];
    case 'simResult': {
      const sum = s.result.summary;
      const demo = s.run.demo ? ' · 데모' : '';
      return [
        `총수익률 ${trendReturn(sum.totalReturnPct)} · 최대 낙폭 ${fmtReturnPct(sum.mddPct)}`,
        `종목 ${s.result.symbols.length}개 · 거래 ${sum.roundTrips}번 · ${dotDate(s.run.from)} ~ ${dotDate(s.run.to)}${demo}`,
      ];
    }
    case 'validation': {
      const hold = s.result.hold.stats.totalPct;
      const idx = s.result.indices.find((i) => i.stats)?.stats?.totalPct;
      const demo = s.run.demo ? ' · 데모' : '';
      return [
        `① 선정만 ${trendReturn(hold)}${idx === undefined ? '' : ` · 지수 대비 ${trendPp(hold - idx)}`}`,
        `상위 ${s.criteria.rank.take}개 · ${REBAL[s.criteria.rebalance]} · ${ym(s.run.from)} ~ ${ym(s.run.to)}${demo}`,
      ];
    }
  }
}

const fetched = (t: number) => `${dotDate(kstDate(t))} ${kstHHMM(t)} 받음`;

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
        `기간: ${dotDate(st.period.from)} ~ ${dotDate(st.period.to)}`,
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
        `시장: ${c.pool.markets.join(', ')} · 종류: ${c.pool.types.map((t) => (t === 'STOCK' ? '주식' : t)).join(', ')}`,
        `묶음 ${s.baskets.length}개${s.baskets.length ? `: ${s.baskets.map((b) => `${b.name}(${b.symbols.length})`).join(', ')}` : ''}`,
        `상위 ${c.rank.take}개 · ${REBAL[c.rebalance]} 재선정`,
        `기간: ${dotDate(c.period.from)} ~ ${dotDate(c.period.to)}`,
        `초기 자금: ${s.capitalHidden ? '비공개' : won(c.capital)}`,
      ];
    }
    case 'compare':
      return [`제목: ${s.title}`, `종목 ${s.symbols.length}개: ${symbolList(s.symbols, names)}`, `보기: ${compareViewText(s.view)}`];
    case 'simResult':
    case 'validation': {
      const initial = s.kind === 'simResult' ? s.strategy.capital.initial : s.criteria.capital;
      return [`제목: ${s.title}`, ...cardLines(s, names), `시세 출처: ${s.run.source} · ${fetched(s.run.fetchedAt)}`, `초기 자금: ${s.capitalHidden ? '비공개' : won(initial)}`];
    }
  }
}

/** 솎은 곡선 안내(설계 3.3) */
export const sampledText = (sampled: { from: number }, kept: number): string =>
  `곡선은 ${sampled.from}점 중 ${kept}점으로 줄였어요 · 수치는 전체 기간 기준이에요`;
