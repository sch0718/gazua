# 토스로 일봉 수집 계획

설계: [2026-11-06-toss-collect-design.md](../specs/2026-11-06-toss-collect-design.md)

1. `tests/toss-collect.test.mjs`(먼저, 실패 확인): 가짜 fetch로
   - 종목 일봉 여러 쪽 넘김·`adjusted=true`·`tv = round(c×v)`·`from~to` 자르기, 지수 일봉 경로
   - 429 뒤 기다렸다 성공 / 계속 429면 실패, 401은 치명, 요청 간격이 `--rate`를 지킴
   - 키·토큰이 오류·로그에 없음
   - `collect`에 토스 클라이언트를 넣으면 `source: 'toss'`, 매매동향·재무 요청 없음, `--update` 이전 flow·fin 제거
2. `scripts/toss-collect.mjs`: `createTossClient` (`scrub`·`dailyCandles`·`indexDaily`).
3. `scripts/collect-market-data.mjs`: `parseArgs`에 `--provider`·`--rate`, `collect`에 `source`, `main`에서 공급자별 키·클라이언트, 자식 프로세스 환경에서 토스 키도 뺀다.
4. `src/lib/marketData/format.ts`: `source` 타입 넓힘.
5. `docs/development.md` 수집 절에 토스 사용법·한계.
6. 검증: `pnpm test:scripts`, `pnpm test -- src/lib/marketData`, `pnpm check`.
