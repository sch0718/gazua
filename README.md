# 가즈아

관심종목을 한 차트에 나란히 놓고 비교하는 모바일 우선 웹앱이에요. GitHub Pages에 정적 사이트로 배포하고, 시세는 증권사 Open API(한국투자증권·토스증권)에서 받아와요.

- 데모: <https://sch0718.github.io/gazua/> (저장소에서 GitHub Pages를 켠 뒤에 열려요. [배포](#배포) 참고)
- 설정과 API 키는 각자 브라우저(localStorage)에만 저장해요. 서버에는 아무것도 올라가지 않아요.
- 증권사 키가 없어도 **데모 데이터**로 모든 화면을 써 볼 수 있어요.

## 주요 기능

- 일(1분봉)·주(1~4)·월(1~6)·년 단위 기간 전환. 1일만 분봉이고 나머지는 일봉이에요.
- 등락률 기본 비교 + 고점 대비 하락률, 시장 대비 초과수익, 상대 거래량, 시가총액
- KRX/NXT 전환. 자동 모드는 **KRX 우선**이에요(KRX가 거래 중이면 KRX, 아니면 NXT).
- 종목별 거래 불가 시간 표시, 한 그룹 최대 8종목, 그룹·프로필 관리
- 차트와 같은 값을 시각×종목 표로 보는 `표 보기`
- 키보드 단축키: `/` 종목 검색 · `[` `]` 기간 이동 · `M` 지표 선택 · `V` 거래소 순환 · `H` 선택 종목 숨기기 · `?` 도움말
- 매매 규칙 시뮬레이션: 관심종목에 내 매수·매도 규칙을 적용해 과거 성과를 보유·지수·ETF와 비교
- 설치형 웹앱(PWA). 앱 셸만 캐시하고 시세 요청은 캐시하지 않아요.

## 데이터 공급자별 준비

브라우저에서 증권사 API를 바로 부를 수 없어서(CORS) 작은 프록시를 거쳐요. 프록시 배포와 HTTP 계약은 [proxy/README.md](proxy/README.md)에 있어요.

### 한국투자증권(KIS)

1. 한국투자증권 계좌를 만들고 [KIS Developers](https://apiportal.koreainvestment.com)에서 Open API를 신청해 앱 키·앱 시크릿을 받아요.
2. Cloudflare Worker로 프록시를 배포해요(무료). 자세한 순서는 [proxy/README.md](proxy/README.md)의 `KIS: Cloudflare Worker`예요. Worker가 KIS의 `:9443` 포트에 닿지 않으면 Node 프록시를 써요([live-check ⑪](docs/live-check.md)).
3. 앱 설정 › 데이터 공급자에서 KIS를 고르고 프록시 URL과 앱 키·시크릿을 넣어요. `연결 진단`이 프록시 → CORS → 토큰 → 시세 순서로 확인해 줘요.
4. KIS가 허용 IP를 요구하는지는 아직 확인하지 못했어요([live-check ④](docs/live-check.md)). IP 문제로 막히면 고정 IP 프록시를 써요.

### 토스증권

1. 토스증권 WTS에서 Open API 키를 발급받아요.
2. 토스 Open API는 **허용된 IP**에서만 호출돼요. 집 PC·NAS에서 프록시 컨테이너를 돌리고 Cloudflare Tunnel로 외부에 노출해요. 순서는 [proxy/README.md](proxy/README.md)의 `토스증권: Docker + Cloudflare Tunnel`이에요.
3. 집 공인 IP를 WTS의 허용 IP에 등록해요. IP가 바뀌면 다시 등록해야 해요(같은 문서의 `IP가 바뀌었을 때`).
4. 앱 설정에서 토스를 고르고 프록시 URL(터널 주소), 프록시 토큰, 키를 넣어요. 토스는 통합 시세만 줘서 거래소 전환이 `통합`으로 고정돼요.

## 시장 데이터 수집

선정 기준 검증(시뮬레이션 › 선정 기준)은 전 종목 일봉이 든 파일 하나를 읽어요. 이 파일은 직접 모아요. 앱은 파일만 읽고 증권사에는 따로 묻지 않아요.

```bash
# 키는 환경변수로만 넣어요. 명령줄에 쓰면 셸 기록에 남으니 입력을 받아 내보내요(화면에 보이지 않아요).
read -rs KIS_APP_KEY && export KIS_APP_KEY
read -rs KIS_APP_SECRET && export KIS_APP_SECRET
corepack pnpm collect -- --years 5 --out ~/gazua-data/
# 이어 받기: 마지막 날짜 이후만 받아 합쳐요.
corepack pnpm collect -- --update ~/gazua-data/market-data-20261016.json.gz
```

- 결과는 `market-data-YYYYMMDD.json.gz`예요. 기본 출력 폴더는 `~/gazua-data/`이고, 저장소 안이면 `.gitignore`에 있는 `data/`만 허용해요.
- **파일을 커밋하지 마세요.** `data/`는 `.gitignore`에 들어 있어요. 앱 키와 시크릿은 파일·로그·셸 기록에 남지 않도록 환경변수로만 넘겨요.
- `--update <파일>`은 종목마다 마지막 날짜 다음부터 받아요. 겹치는 마지막 5거래일이 기존 값과 다르면(액면분할 등) 그 종목만 전체를 다시 받아요.
- `--years`는 1~10년이에요(기본 5년). 앱이 풀린 파일을 문자열 하나로 읽어서, 전 종목 10년을 넘으면 브라우저 문자열 한도에 닿을 수 있어요.
- `--paper`는 모의투자 서버를 써요. 기본은 실전 서버예요.
- 한 종목의 일봉을 페이지 한도(80번 요청)까지 받아도 시작일에 닿지 못하면, 앞부분을 자르지 않고 그 종목을 실패로 알려요.
- **받는 끝 날짜.** 평일 KST 18시 전이면 아직 끝나지 않은 오늘 봉을 받지 않고 전날까지 받아요. 18시 이후에는 오늘까지 받아요.
- 중간에 끊기면 `<출력 파일>.partial`에 진행분이 남고, 같은 날 다시 실행하면 이어서 받아요.
- 예상 시간과 크기(추정이며 첫 실제 수집에서 재서 고쳐요): 5년 전 종목은 (종목 수 × 종목당 일봉 요청 수 ≈ 5년 ÷ 100거래일씩) ÷ 초당 18건으로 어림하면 수십 분에서 한두 시간 걸리고, 압축 후 수십 MB로 봐요. 실측값은 [live-check ⑱](docs/live-check.md)에 적어요.
- **환율·유가와 테마도 함께 받아요.** 파일은 버전 2로 쓰여요. FRED에서 원/달러(`DEXKOUS`)와 WTI(`DCOILWTICO`) CSV를 키 없이 받고(일봉 시작 1년 전부터, 민감도 계산의 워밍업용), KIS 테마 마스터(`theme_code.mst`)를 받아 파일에 있는 종목만 남겨요.
- **받지 못해도 멈추지 않아요.** FRED나 테마 다운로드가 실패하면 경고를 남기고 환율·유가를 비우거나(계열별) 테마를 빈 목록으로 둔 채 수집을 끝까지 마쳐요. `--update`에서 FRED가 실패하면 이전 파일의 환율·유가를 그대로 지켜요.
- 버전 1 파일(이전에 받은 파일)도 그대로 읽혀요. 다만 환율·유가·테마 조건은 `다시 수집하면 쓸 수 있어요`로 막혀 있으니, 쓰려면 다시 수집해 새 파일을 가져와요.
- **투자자 매매동향도 종목마다 받아요.** 파일은 버전 3으로 쓰여요. 일봉 다음에 종목별로 외국인·기관·개인의 일별 순매수 금액을 받아요(KIS `FHPTJ04160001`). 경로·필드·금액 단위는 아직 확인하지 못한 가정이에요([live-check ㉓](docs/live-check.md)).
- `--flows-years N`은 매매동향을 최근 N년으로 줄여요(1~10년, 기본은 일봉 기간). `--no-flows`는 매매동향을 새로 받지 않아요(`--update`면 이전 값은 그대로 둬요).
- **매매동향 실패 처리.** 종목 하나가 실패하면 그 종목만 매매동향 없이 두고 계속해요. 치명적이지 않은 실패가 연속 20번 나면 매매동향 받기를 멈추지만, 파일은 경고와 함께 끝까지 써요. 401·403 같은 치명 오류는 수집을 멈추고 진행분을 `.partial`에 남겨요. 실패가 전체의 절반을 넘으면 경고를 더 크게 띄워요.
- `--update`는 매매동향을 일봉의 끝이 아니라 이전 파일의 매매동향 끝에서 5번째 날부터 이어 받아요. 마지막 5일은 다시 받아 정정된 값을 반영하고(새로 받은 값이 이전 값을 덮어써요), 한 번 실패한 종목도 다음 `--update`에서 메워져요. 이번에 받기가 실패하면 그 종목의 이전 값을 지켜요.
- 버전 1·2 파일은 그대로 읽히지만 투자자 매매동향 조건(순매수 규모·연속 순매수, 정렬 `수급 순`)은 `다시 수집하면 쓸 수 있어요`로 막혀 있어요. 쓰려면 다시 수집해 새 파일을 가져와요.
- **재무도 STOCK 종목마다 받아요.** 파일은 버전 4로 쓰여요. 종목마다 KIS 손익계산서와 대차대조표를 연간·분기로 한 번씩, 모두 4번 불러 분기 재무(매출·영업이익·순이익·자본·부채)를 만들어요. REIT·기타 종목은 받지 않아요. 경로·TR·필드·금액 단위·분기 손익이 누적값이라는 가정은 `scripts/fetch-fundamentals.mjs`의 `FIN_API`에 있고 아직 확인하지 못했어요([live-check ㉕](docs/live-check.md)).
- `--no-fins`는 재무를 새로 받지 않아요(`--update`면 이전 재무는 그대로 둬요).
- **재무 실패 처리.** 매매동향과 같아요. 종목 하나가 실패하면 그 종목만 재무 없이 두고 계속해요. 치명적이지 않은 실패가 연속 20번 나면 재무 받기를 멈추지만, 파일은 경고와 함께 끝까지 써요. 401·403 같은 치명 오류는 수집을 멈추고 진행분을 `.partial`에 남겨요. 실패가 STOCK 종목의 절반을 넘으면 경고를 더 크게 띄워요(분모는 STOCK만 세요).
- `--update`는 재무를 다시 받아요. 새로 받은 재무에 이전 파일의 더 이른 확정 분기를 앞에 이어 붙이고, 받기가 실패하면 그 종목의 이전 재무를 지켜요.
- 버전 1~3 파일은 그대로 읽히지만 재무·가치 조건(PER·PBR·ROE·영업이익률·성장·부채비율·흑자, 정렬 `재무 순`)은 `다시 수집하면 쓸 수 있어요`로 막혀 있어요. 쓰려면 다시 수집해 새 파일을 가져와요.
- 앱에서는 설정 › 데이터 › `시장 데이터 가져오기`로 파일을 골라요. 파일은 이 기기의 IndexedDB에만 저장돼요.
- 한계: 지금 상장된 종목만 들어 있어 상장폐지 종목이 빠져요(생존 편향). 업종·상장주식수는 수집일 기준이에요.

## 보안 주의

- API 키는 **이 브라우저에만** 저장돼요. 저장소·프록시 로그·URL에 남기지 않아요.
- **토스 키는 주문 권한을 가져요.** 키가 새면 주문이 나갈 수 있으니 `키를 암호로 잠그기`를 켜 두길 권장해요. 공용 기기에서는 쓰지 말고, 다 쓴 뒤 `이 기기에서 키 삭제`를 눌러요.
- 프록시는 시세 조회 경로만 허용 목록으로 전달하고, **주문·계좌 경로는 `403 proxy-path-blocked`로 거절**해요. 프록시를 고칠 때 허용 목록을 넓히지 마세요.
- 프록시의 `ALLOWED_ORIGINS`에는 앱 주소(출처)만 적고, 가능하면 `PROXY_TOKEN`도 설정해요.

## 개발

Node 22 이상이 필요해요. 패키지 관리자는 `package.json`의 `packageManager`가 정한 pnpm이에요.

```bash
corepack pnpm install
corepack pnpm dev          # 개발 서버 (http://localhost:5173/gazua/)
corepack pnpm test         # 단위·컴포넌트 테스트 (TZ=America/New_York으로 돌려요)
corepack pnpm check        # svelte-check 타입 검사
corepack pnpm test:demo    # 초기 PoC(poc/) 회귀 테스트
corepack pnpm build        # dist/ 생성 (prebuild가 종목 유니버스를 내려받아요)
corepack pnpm universe     # 종목 유니버스(public/universe.json)만 다시 받기
corepack pnpm --filter proxy test
```

모든 시각 계산은 KST 고정이라 기기 시간대와 무관해요. 테스트가 `America/New_York`으로 도는 것도 그걸 확인하려는 거예요.

## 배포

GitHub Pages로 배포해요. 워크플로는 [.github/workflows/deploy.yml](.github/workflows/deploy.yml)이고 `main`에 push할 때, 수동 실행할 때, 그리고 평일 06:00(KST)에 돌아요. 평일 아침 실행은 종목 유니버스를 새로 받아 다시 배포하는 용도예요.

GitHub는 저장소에 60일 동안 활동이 없으면 예약(schedule) 워크플로를 자동으로 끄니, 유니버스 갱신이 멈췄다면 Actions 탭에서 워크플로를 다시 켜거나 수동으로 실행해요.

저장소 설정은 한 번 직접 바꿔야 해요.

1. 저장소 **Settings › Pages › Build and deployment › Source**를 `GitHub Actions`로 바꿔요.
2. 비공개 저장소에서 Pages를 쓰려면 유료 플랜이 필요해요.
3. 배포 주소가 `https://<사용자>.github.io/gazua/`가 되도록 저장소 이름은 `gazua`로 맞춰요(`vite.config.ts`의 `base`).
4. 프록시의 `ALLOWED_ORIGINS`에 `https://<사용자>.github.io`를 넣어요.

## 문서

- 설계: [docs/superpowers/specs/2026-10-11-stock-compare-design.md](docs/superpowers/specs/2026-10-11-stock-compare-design.md)
- 시뮬레이션 설계: [docs/superpowers/specs/2026-10-12-backtest-simulation-design.md](docs/superpowers/specs/2026-10-12-backtest-simulation-design.md)
- 선정 기준 검증 설계: [docs/superpowers/specs/2026-10-16-selection-criteria-validation-design.md](docs/superpowers/specs/2026-10-16-selection-criteria-validation-design.md)
- 화면 목업: [docs/design/2026-10-11-mockups.html](docs/design/2026-10-11-mockups.html)
- 구현 계획: [docs/superpowers/plans/2026-10-11-gazua.md](docs/superpowers/plans/2026-10-11-gazua.md)
- 시뮬레이션 구현 계획: [docs/superpowers/plans/2026-10-12-backtest-simulation.md](docs/superpowers/plans/2026-10-12-backtest-simulation.md)
- 시뮬레이션 화면 리뷰와 처리 결과: [docs/design/2026-10-13-simulation-ui-review.md](docs/design/2026-10-13-simulation-ui-review.md)
- 실연결 점검 목록: [docs/live-check.md](docs/live-check.md)
- 프록시: [proxy/README.md](proxy/README.md)
- 초기 PoC: [poc/gazua-poc.html](poc/gazua-poc.html)
- 모션 데모: [motion/README.md](motion/README.md)
