# 가즈아

관심종목을 한 차트에 놓고 비교하고, 매매 규칙을 과거 데이터로 시험하는 주식 앱(https://gazua.sch0718.dev). Svelte 5 PWA(`src/`, GitHub Pages)에 다음이 붙습니다. 개발·배포 절차는 `docs/development.md`에 있습니다.

- `proxy/`: KIS·토스증권 API가 브라우저 CORS를 막아서 두는 프록시. KIS는 Worker, 토스는 고정 IP의 Node 컨테이너.
- `sync-worker/`: 동기화·공유(D1).
- `cli/`: 시장 데이터 수집.

## 명령

```bash
corepack pnpm dev        # http://localhost:5173/
corepack pnpm check      # svelte-check 타입 검사
corepack pnpm test       # TZ=America/New_York으로 돈다(모든 시각 계산이 KST 고정인지 확인하려고)
corepack pnpm test:demo  # poc/ 회귀
corepack pnpm e2e        # Playwright
corepack pnpm build      # prebuild가 종목 유니버스를 내려받는다
corepack pnpm --filter proxy test
```

- 끝내기 전에 `check`와 `test`를 돌립니다. 바꾼 곳이 `proxy/`·`cli/`·`sync-worker/`면 그 패키지 시험도 돌립니다.
- `main`에 push하면 GitHub Actions가 배포합니다(평일 06:00 KST 예약 실행도 있음). sync-worker API를 바꾸면 Worker를 먼저 배포합니다. Worker가 옛것이면 앱·CLI가 「서버를 업데이트해 주세요」로 멈추기 때문입니다.
- 공용 `@sch0718/*` 패키지는 GitHub Packages에서 받습니다. 토큰은 환경변수 `GITHUB_PACKAGES_TOKEN`으로만 넘기고 파일·로그에 쓰지 않습니다. KIS·토스 키도 환경변수나 `.env.*`(커밋 안 함)로만 다룹니다.
- 전략·백테스트 결과를 따져 달라는 요청에는 `strategy-critique` 스킬을 씁니다.

## 웹 화면

화면 작업 규칙은 `~/.claude/rules/modern-web.md`(웹 파일을 다룰 때 자동으로 실림)를 따릅니다. 이 저장소의 대상은 `src/`, `index.html`, `auth/callback/`이고, `sync-worker/`, `proxy/`, `cli/`, `scripts/`, `motion/`은 대상이 아닙니다.
