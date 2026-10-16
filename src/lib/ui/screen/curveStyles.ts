// 선정 기준 결과 곡선의 지수·ETF 선 모양. 가는 선도 배경 위 3:1이 나오는 토큰만 쓴다(라이트·다크 모두, tokens.test).
// ETF 선은 등락색(한국 관례 빨강 상승·파랑 하락)으로 읽히지 않게 파랑 --s7·빨강을 쓰지 않는다.
// 두 번째 ETF는 두 번째 지수와 같은 --s3이지만 지수는 1.5px 점선, ETF는 2px 실선이라 모양으로 가린다.
import type { CurveLine } from '../simulate/EquityChart.svelte';

export const INDEX_STYLES: CurveLine['color'][] = [['--t2', '#5b6069'], ['--s3', '#4a3aa7']];
export const BENCH_STYLES: Pick<CurveLine, 'color' | 'width' | 'dashed'>[] = [
  { color: ['--s6', '#008300'], width: 2, dashed: false },
  { color: ['--s3', '#4a3aa7'], width: 2, dashed: false },
  { color: ['--t3', '#676d77'], width: 2, dashed: false },
];
