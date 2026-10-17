// 선정 기준 결과 곡선의 지수·ETF 선 모양. 가는 선도 배경 위 3:1이 나오는 토큰만 쓴다(라이트·다크 모두, tokens.test).
// ETF 선은 등락색으로 읽히지 않게 색 관례마다 다른 --etf-1·--etf-2를 쓴다(tokens.css: 한국 관례 초록·황토, 글로벌 관례 파랑·황토).
// 지수 선(회색·보라 점선)과 색이 겹치지 않는다.
import type { CurveLine } from '../simulate/EquityChart.svelte';

export const INDEX_STYLES: CurveLine['color'][] = [['--t2', '#5b6069'], ['--s3', '#4a3aa7']];
export const BENCH_STYLES: Pick<CurveLine, 'color' | 'width' | 'dashed'>[] = [
  { color: ['--etf-1', '#008300'], width: 2, dashed: false },
  { color: ['--etf-2', '#9a6700'], width: 2, dashed: false },
  { color: ['--t3', '#676d77'], width: 2, dashed: false },
];
