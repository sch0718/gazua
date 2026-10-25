// 공유 스냅샷의 사람이 읽는 요약(만들기 미리 보기와 읽기 화면이 함께 쓴다).
import type { ShareSnapshot } from './snapshot';

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const on = (b: boolean) => (b ? '켬' : '끔');

export function snapshotLines(s: ShareSnapshot): string[] {
  switch (s.kind) {
    case 'group':
      return [`제목: ${s.title}`, `종목 ${s.symbols.length}개: ${s.symbols.join(', ') || '없음'}`];
    case 'strategy': {
      const st = s.strategy;
      const symbols = st.universe.kind === 'symbols' ? st.universe.symbols : [];
      return [
        `제목: ${s.title}`,
        `종목 ${symbols.length}개: ${symbols.join(', ') || '없음'}`,
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
  }
}
