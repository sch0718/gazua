# 개발 문서

서비스 소개와 사용법은 [README](../README.md)와 [도움말](help/README.md)에 있어요. 증권사 키와 프록시는 [증권사 연결](providers.md)을 보세요.

## 시장 데이터 수집

선정 기준 검증(시뮬레이션 › 선정 기준)은 전 종목 일봉이 든 파일 하나를 읽어요. 이 파일은 직접 모아요. 앱은 파일만 읽고 증권사에는 따로 묻지 않아요.

```bash
# 처음 한 번(90일마다): 수집 계정 표시를 받으려고 CLI로 로그인해요. Drive 전달을 쓰면 drive login으로 충분해요.
corepack pnpm -C cli build
corepack pnpm --filter gazua-cli exec gazua drive login   # 또는 gazua login
# 키는 환경변수로만 넣어요. 명령줄에 쓰면 셸 기록에 남으니 입력을 받아 내보내요(화면에 보이지 않아요).
read -rs KIS_APP_KEY && export KIS_APP_KEY
read -rs KIS_APP_SECRET && export KIS_APP_SECRET
corepack pnpm collect -- --years 5 --out ~/gazua-data/
# 이어 받기: 마지막 날짜 이후만 받아 합쳐요.
corepack pnpm collect -- --update ~/gazua-data/market-data-20261016.json.gz
```

- 결과는 `market-data-YYYYMMDD.json.gz`예요. 기본 출력 폴더는 `~/gazua-data/`이고, 저장소 안이면 `.gitignore`에 있는 `data/`만 허용해요.
- **수집 계정 표시.** 파일은 다른 사람에게 주지 않아요(KIS 약관 제5조 ③). 수집을 시작하기 전에 `gazua owner`로 동기화 계정의 해시(`owner`, 이메일이 아니에요)를 받아 파일에 넣고, 앱은 그 계정으로 로그인했을 때만 가져와요. 실수를 막는 장치이고 우회를 막지는 않아요.
  - CLI 로그인(`gazua drive login` 또는 `gazua login`)이 없거나 만료됐으면 수집을 시작하지 않고 멈춰요. CLI가 옛 빌드면 `pnpm -C cli build`를 다시 하라고 안내해요.
  - `--no-owner`는 표시 없이 수집해요(로그인 없는 개발·시험용). 표시 없는 파일은 어느 앱이든 가져와요.
  - 배포 순서: sync-worker(`GET /v1/cli/owner`) → CLI 다시 빌드 → 앱. Worker가 옛것이면 「서버(Worker)를 업데이트해 주세요」로 멈춰요.
- **파일을 커밋하지 마세요.** `data/`는 `.gitignore`에 들어 있어요. 앱 키와 시크릿은 파일·로그·셸 기록에 남지 않도록 환경변수로만 넘겨요.
- `--update <파일>`은 종목마다 마지막 날짜 다음부터 받아요. 겹치는 마지막 5거래일이 기존 값과 다르면(액면분할 등) 그 종목만 전체를 다시 받아요.
- `--years`는 1~10년이에요(기본 5년). 앱이 풀린 파일을 문자열 하나로 읽어서, 전 종목 10년을 넘으면 브라우저 문자열 한도에 닿을 수 있어요.
- `--paper`는 모의투자 서버를 써요. 기본은 실전 서버예요.
- 한 종목의 일봉을 페이지 한도(80번 요청)까지 받아도 시작일에 닿지 못하면, 앞부분을 자르지 않고 그 종목을 실패로 알려요.
- **받는 끝 날짜.** 평일 KST 18시 전이면 아직 끝나지 않은 오늘 봉을 받지 않고 전날까지 받아요. 18시 이후에는 오늘까지 받아요.
- 중간에 끊기면 `<출력 파일>.partial`에 진행분이 남고, 같은 날 다시 실행하면 이어서 받아요.
- 예상 시간과 크기(추정이며 첫 실제 수집에서 재서 고쳐요): 5년 전 종목은 (종목 수 × 종목당 일봉 요청 수 ≈ 5년 ÷ 100거래일씩) ÷ 초당 18건으로 어림하면 수십 분에서 한두 시간 걸리고, 압축 후 수십 MB로 봐요. 실측값은 [live-check ⑱](live-check.md)에 적어요.
- **환율·유가와 테마도 함께 받아요.** 파일은 버전 2로 쓰여요. FRED에서 원/달러(`DEXKOUS`)와 WTI(`DCOILWTICO`) CSV를 키 없이 받고(일봉 시작 1년 전부터, 민감도 계산의 워밍업용), KIS 테마 마스터(`theme_code.mst`)를 받아 파일에 있는 종목만 남겨요.
- **받지 못해도 멈추지 않아요.** FRED나 테마 다운로드가 실패하면 경고를 남기고 환율·유가를 비우거나(계열별) 테마를 빈 목록으로 둔 채 수집을 끝까지 마쳐요. `--update`에서 FRED가 실패하면 이전 파일의 환율·유가를 그대로 지켜요.
- 버전 1 파일(이전에 받은 파일)도 그대로 읽혀요. 다만 환율·유가·테마 조건은 `다시 수집하면 쓸 수 있어요`로 막혀 있으니, 쓰려면 다시 수집해 새 파일을 가져와요.
- **투자자 매매동향도 종목마다 받아요.** 파일은 버전 3으로 쓰여요. 일봉 다음에 종목별로 외국인·기관·개인의 일별 순매수 금액을 받아요(KIS `FHPTJ04160001`). 경로·필드·금액 단위는 아직 확인하지 못한 가정이에요([live-check ㉓](live-check.md)).
- `--flows-years N`은 매매동향을 최근 N년으로 줄여요(1~10년, 기본은 일봉 기간). `--no-flows`는 매매동향을 새로 받지 않아요(`--update`면 이전 값은 그대로 둬요).
- **매매동향 실패 처리.** 종목 하나가 실패하면 그 종목만 매매동향 없이 두고 계속해요. 치명적이지 않은 실패가 연속 20번 나면 매매동향 받기를 멈추지만, 파일은 경고와 함께 끝까지 써요. 401·403 같은 치명 오류는 수집을 멈추고 진행분을 `.partial`에 남겨요. 실패가 전체의 절반을 넘으면 경고를 더 크게 띄워요.
- `--update`는 매매동향을 일봉의 끝이 아니라 이전 파일의 매매동향 끝에서 5번째 날부터 이어 받아요. 마지막 5일은 다시 받아 정정된 값을 반영하고(새로 받은 값이 이전 값을 덮어써요), 한 번 실패한 종목도 다음 `--update`에서 메워져요. 이번에 받기가 실패하면 그 종목의 이전 값을 지켜요.
- 버전 1·2 파일은 그대로 읽히지만 투자자 매매동향 조건(순매수 규모·연속 순매수, 정렬 `수급 순`)은 `다시 수집하면 쓸 수 있어요`로 막혀 있어요. 쓰려면 다시 수집해 새 파일을 가져와요.
- **재무도 STOCK 종목마다 받아요.** 파일은 버전 4로 쓰여요. 종목마다 KIS 손익계산서와 대차대조표를 연간·분기로 한 번씩, 모두 4번 불러 분기 재무(매출·영업이익·순이익·자본·부채)를 만들어요. REIT·기타 종목은 받지 않아요. 경로·TR·필드·금액 단위·분기 손익이 누적값이라는 가정은 `scripts/fetch-fundamentals.mjs`의 `FIN_API`에 있고 아직 확인하지 못했어요([live-check ㉕](live-check.md)).
- `--no-fins`는 재무를 새로 받지 않아요(`--update`면 이전 재무는 그대로 둬요).
- **재무 실패 처리.** 매매동향과 같아요. 종목 하나가 실패하면 그 종목만 재무 없이 두고 계속해요. 치명적이지 않은 실패가 연속 20번 나면 재무 받기를 멈추지만, 파일은 경고와 함께 끝까지 써요. 401·403 같은 치명 오류는 수집을 멈추고 진행분을 `.partial`에 남겨요. 실패가 STOCK 종목의 절반을 넘으면 경고를 더 크게 띄워요(분모는 STOCK만 세요).
- `--update`는 재무를 다시 받아요. 새로 받은 재무에 이전 파일의 더 이른 확정 분기를 앞에 이어 붙이고, 받기가 실패하면 그 종목의 이전 재무를 지켜요.
- 버전 1~3 파일은 그대로 읽히지만 재무·가치 조건(PER·PBR·ROE·영업이익률·성장·부채비율·흑자, 정렬 `재무 순`)은 `다시 수집하면 쓸 수 있어요`로 막혀 있어요. 쓰려면 다시 수집해 새 파일을 가져와요.
- 앱에서는 설정 › 데이터 › `시장 데이터 가져오기`로 파일을 골라요. 파일은 이 기기의 IndexedDB에만 저장돼요.
- 한계: 지금 상장된 종목만 들어 있어 상장폐지 종목이 빠져요(생존 편향). 업종·상장주식수는 수집일 기준이에요.

### 토스로 수집(KIS 키가 없을 때)

KIS 키가 없으면 `--provider toss`로 종목·지수 일봉만 토스에서 받아요([설계](superpowers/specs/2026-11-06-toss-collect-design.md), 깊이 실측은 [live-check ㉝](live-check.md)). 종목 마스터·업종·테마·환율·유가·수집 계정 표시·`--drive`는 KIS 수집과 같아요.

```bash
# .env.toss(커밋되지 않아요)에 TOSS_CLIENT_ID=..., TOSS_CLIENT_SECRET=... 를 넣어 둬요.
node --env-file=.env.toss scripts/collect-market-data.mjs --provider toss --years 5 --out ~/gazua-data/
# 이어 받기
node --env-file=.env.toss scripts/collect-market-data.mjs --provider toss --update ~/gazua-data/market-data-20261106.json.gz
```

- **수집용 키를 따로 만들어요.** 토스는 키 하나에 토큰 하나라, 앱과 같은 키로 수집하면 앱의 토큰이 무효가 돼요(앱에서 다시 연결해야 해요).
- **허용 IP에서만 돼요.** 토스 Open API에 등록한 IP의 기기에서 돌려요. 아니면 토큰 발급에서 멈춰요.
- **매매동향·재무는 없어요.** 토스는 매매동향을 수량으로만 주고 재무는 주지 않아요. 파일에 넣지 않고, `--update`로 KIS 파일을 이어 받아도 이전 매매동향·재무를 지워요(끝 날짜가 멈춘 값이 조건에 쓰이지 않게). 앱은 이 조건들을 `다시 수집하면 쓸 수 있어요`로 막아요. `--no-flows`·`--no-fins`는 붙이지 않아도 돼요.
- **거래대금은 근사값이에요.** 토스 일봉에는 거래대금이 없어 `수정 종가 × 거래량`(반올림)으로 채워요. 평균 거래대금 조건에 쓰이고, 실제 대금과 조금 다를 수 있어요. KIS 파일을 `--update`하면 이전 날짜는 KIS 값, 새 날짜는 근사값이에요.
- **호출 속도.** 기본은 초당 2건이에요(실측에서 초당 2.5건에도 `429`가 났어요). `--rate <초당 건수>`(0.1~10)로 바꿔요. `429`가 오면 `Retry-After`만큼, 없으면 2·4·8·16·30초 기다렸다 다시 하고, 6번째에도 `429`면 그 종목을 실패로 둬요(연속 20번 실패면 멈춰요). 401·403은 바로 멈춰요.
- 예상 시간(추정, 첫 수집에서 재서 고쳐요): 5년 전 종목은 종목당 7쪽쯤이라 초당 2건이면 몇 시간, `--update`는 종목당 1쪽이라 수십 분이에요.
- 파일의 `source`는 `toss`예요. 다른 공급자로 받던 `.partial`은 이어 받지 않고 처음부터 받아요.

### Drive 전달(선택)

수집한 파일을 내 Google Drive 앱 전용 폴더(appDataFolder)에 올려 다른 기기에서 받게 할 수 있어요. 시장 파일은 공개 배포하지 않고 본인 Drive에만 둬요.

```bash
# 처음 한 번: 서버 로그인 + Google 로그인(설정은 cli/README.md의 「Drive 전달」)
corepack pnpm --filter gazua-cli exec gazua drive login
# 수집을 마치고 바로 올려요.
corepack pnpm collect -- --years 5 --drive
```

- 받는 쪽은 앱의 설정 › 데이터 › Drive 전달이에요. 목록에서 파일을 골라 받으면 기존 가져오기와 같은 검증을 거쳐 이 기기에 저장돼요.
- `--drive`는 일봉을 받지 못한 종목이 하나라도 있으면 올리지 않아요(설계 D11). 실패한 수집 파일이 다른 기기로 퍼지지 않게 하려는 거예요.
- Drive에는 기본 2개만 남기고 오래된 것부터 지워요(`gazua drive upload <파일> --keep N`, 1~5).
- 직접 올릴 때는 `gazua drive upload <파일>`, 상태는 `gazua drive status`, 끊을 때는 `gazua drive logout`이에요. 자세한 내용은 [cli/README.md](../cli/README.md)를 보세요.

## 개발

Node 22 이상이 필요해요. 패키지 관리자는 `package.json`의 `packageManager`가 정한 pnpm이에요.

**설치에는 GitHub Packages 토큰이 필요해요.** 공용 패키지(`@sch0718/seen-store` 등)는 [sch0718-toolkit-web](https://github.com/sch0718/sch0718-toolkit-web)에서 GitHub Packages로 발행돼요. 저장소 루트의 `.npmrc`는 `@sch0718/*`만 GitHub Packages에서 받게 하고, 나머지 의존성은 그대로 npmjs.com에서 받아요.

- `read:packages` 권한만 준 personal access token (classic)을 만들어 셸 설정(`~/.zshrc` 등)에 `export GITHUB_PACKAGES_TOKEN=<토큰>`으로 넣어요.
- 사용자 `~/.npmrc`에 아래 한 줄을 넣어요. 토큰 값이 아니라 변수 이름만 적어요. 지금 쓰는 pnpm(10.34.6)은 저장소에 커밋되는 프로젝트 `.npmrc`의 인증 줄에서는 `${변수}`를 풀지 않고 무시해서, 인증은 사용자 설정에 둬야 해요.
  ```ini
  //npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
  ```
- 토큰이 없으면 `pnpm install`이 공용 패키지를 받지 못해 실패해요(401). 설치가 아닌 명령(`test`·`build`·`--filter proxy build` 등)은 그대로 돌아요.
- 토큰 값은 저장소·`.npmrc`·로그에 적지 않아요. classic 토큰은 만료되면 모든 곳의 설치가 함께 실패해요. 만료일을 적어 두고, 바꿀 때 이 기기와 클라우드 세션 환경 변수를 함께 갱신해요.

```bash
corepack pnpm install
corepack pnpm dev          # 개발 서버 (http://localhost:5173/)
corepack pnpm test         # 단위·컴포넌트 테스트 (TZ=America/New_York으로 돌려요)
corepack pnpm check        # svelte-check 타입 검사
corepack pnpm test:demo    # 초기 PoC(poc/) 회귀 테스트
corepack pnpm build        # dist/ 생성 (prebuild가 종목 유니버스를 내려받아요)
corepack pnpm universe     # 종목 유니버스(public/universe.json)만 다시 받기
corepack pnpm build:motion # 소개 그림·도움말 그림·글·앱 도움말 문구 다시 만들기
corepack pnpm --filter proxy test
```

README 소개 그림(`docs/readme/`)과 [도움말](help/README.md) 그림(`public/help/img/`)은 `scripts/motion/`이 앱 토큰(`src/lib/ui/tokens.css`)의 색으로 그리는 애니메이션 SVG(라이트·다크)예요. 도움말 그림은 문서와 앱(`#/help`)이 같은 파일을 쓰고, 앱 도움말 문구(`src/lib/help/content.ts`)도 같은 정의에서 만들어요. 화면 문구가 바뀌면 `scripts/motion/help-pages.mjs`를 고치고 `build:motion`으로 다시 만들어요. 만든 파일은 직접 고치지 않아요.

모든 시각 계산은 KST 고정이라 기기 시간대와 무관해요. 테스트가 `America/New_York`으로 도는 것도 그걸 확인하려는 거예요.

### 클라우드 세션 (Claude Code on the web)

클라우드 세션은 매번 새 Ubuntu 가상 머신에서 시작해요. Node 22·pnpm·git은 기본으로 있어요.

- **의존성**: 저장소의 `.claude/settings.json` SessionStart hook(`.claude/hooks/session-start.sh`)이 `CLAUDE_CODE_REMOTE=true`일 때만 `corepack pnpm install --frozen-lockfile`을 돌려요. 락파일이 그대로면 건너뛰어요. 로컬 세션에서는 아무것도 하지 않아요. `GITHUB_PACKAGES_TOKEN`이 없으면 설치하지 않고 안내만 남겨요. 있으면 사용자 `~/.npmrc`에 인증 줄(변수 이름만)을 넣고 설치해요.
- **도구는 클라우드 환경 설정에서 넣어요**(claude.ai/code › 환경 선택 › 설정). 설정 스크립트는 첫 세션에 한 번 돌고 결과가 캐시돼요.
  - 네트워크: Custom + "Also include default list of common package managers", 그리고 `npm.pkg.github.com`(공용 패키지), `new.real.download.dws.co.kr`(종목 유니버스), `cdn.playwright.dev`, `playwright.download.prss.microsoft.com`, `playwright.azureedge.net`
  - 환경 변수: `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`, `GITHUB_PACKAGES_TOKEN=<read:packages classic 토큰>`(공용 패키지 설치용)
  - 설정 스크립트:
    ```bash
    #!/bin/bash
    set -e
    export PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
    export DEBIAN_FRONTEND=noninteractive
    # 이미지에 있는 /etc/zsh/zshrc 때문에 dpkg가 묻다가 멈추지 않게 기존 설정을 유지한다. zsh는 문법 검사용이라 실패해도 계속한다.
    apt-get update -qq
    apt-get install -y -qq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold zsh || echo "zsh 설치 실패(계속 진행)"
    corepack enable || true
    npx -y playwright@1.63.0 install --with-deps chromium
    chmod -R a+rX /opt/ms-playwright
    ```
  - Playwright 버전은 `pnpm-lock.yaml`의 `@playwright/test`와 맞춰요. 바뀌면 설정 스크립트도 고쳐요.
- 증권사 키·프록시 토큰은 클라우드 환경에 넣지 않아요. 테스트는 모두 녹화된 응답으로 돌아요.

## 배포

GitHub Pages로 배포해요. 워크플로는 [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)이고 `main`에 push할 때, 수동 실행할 때, 그리고 평일 06:00(KST)에 돌아요. 평일 아침 실행은 종목 유니버스를 새로 받아 다시 배포하는 용도예요.

GitHub는 저장소에 60일 동안 활동이 없으면 예약(schedule) 워크플로를 자동으로 끄니, 유니버스 갱신이 멈췄다면 Actions 탭에서 워크플로를 다시 켜거나 수동으로 실행해요.

**공용 패키지 접근 권한.** 공용 패키지마다 GitHub 패키지 설정 › **Manage Actions access** › Add repository로 `sch0718/gazua`에 **Read** 권한을 줘요(지금은 `@sch0718/seen-store`, `@sch0718/kakao-share`). 빠지면 CI·배포의 `pnpm install`이 403으로 실패해요. 워크플로는 설치하는 job에 `packages: read` 권한을 두고, 러너의 `~/.npmrc`에 인증 줄을 넣은 뒤 `GITHUB_PACKAGES_TOKEN`으로 `secrets.GITHUB_TOKEN`을 넘겨요.

저장소 설정은 한 번 직접 바꿔야 해요.

1. 저장소 **Settings › Pages › Build and deployment › Source**를 `GitHub Actions`로 바꿔요.
2. 비공개 저장소에서 Pages를 쓰려면 유료 플랜이 필요해요.
3. 앱은 도메인 루트에서 열려요(`vite.config.ts`의 `base: '/'`). 커스텀 도메인을 이렇게 붙여요.
   - Cloudflare DNS에 `CNAME gazua → <사용자>.github.io`를 **DNS 전용(회색 구름)**으로 추가해요. 대상은 내 도메인이 아니라 `github.io` 주소예요.
   - GitHub 계정 Settings › Pages에서 도메인을 인증(TXT 레코드)해 두면 다른 사람이 가로챌 수 없어요.
   - 저장소 Settings › Pages › Custom domain에 `gazua.<도메인>`을 넣고, 인증서가 나오면 **Enforce HTTPS**를 켜요. `.dev`는 HTTPS로만 열려요.
   - 커스텀 도메인 없이 `https://<사용자>.github.io/gazua/`로 쓰려면 `base`를 `/gazua/`로 되돌려요. 도메인 지정과 `base`는 함께 바꿔야 해요. 하나만 바뀌면 화면 파일 경로가 어긋나 빈 화면이 떠요.
4. 프록시의 `ALLOWED_ORIGINS`에 앱 출처(`https://gazua.<도메인>`)를 넣어요.
5. 주소(출처)가 바뀌면 브라우저 저장소가 따로라 그룹·설정·키·시장 데이터가 따라오지 않아요. 옛 주소에서 설정 › 데이터 › 내보내기 한 파일을 새 주소에서 가져와요.
6. (선택) 동기화·공유를 켜려면 [sync-worker/README.md](../sync-worker/README.md)의 순서대로 D1·Worker와 쓸 로그인 공급자를 준비하고, 저장소 Actions **Variables**에 `VITE_SYNC_API_URL`과 Google용 `VITE_FIREBASE_*` 또는 소셜용 `VITE_KAKAO_LOGIN_CLIENT_ID`(카카오 REST API 키)·`VITE_NAVER_LOGIN_CLIENT_ID`(네이버 Client ID)를 넣어요. 소셜 client id는 공개 값이고, 설정된 공급자만 단추가 보여요. Firebase 없이 소셜만 쓸 수도 있어요. 카카오톡으로 보내기는 `VITE_KAKAO_JS_KEY`도 넣어요(선택). 개발 전용 `VITE_SOCIAL_DEV_MOCK`는 Actions에 넣지 않아요. API 주소와 로그인 공급자 설정이 없으면 동기화 없이 빌드돼요.

## 설계·계획 문서

- 설계: [docs/superpowers/specs/2026-10-11-stock-compare-design.md](superpowers/specs/2026-10-11-stock-compare-design.md)
- 시뮬레이션 설계: [docs/superpowers/specs/2026-10-12-backtest-simulation-design.md](superpowers/specs/2026-10-12-backtest-simulation-design.md)
- 내 성과 설계: [docs/superpowers/specs/2026-10-23-account-performance-design.md](superpowers/specs/2026-10-23-account-performance-design.md)
- 선정 기준 검증 설계: [docs/superpowers/specs/2026-10-16-selection-criteria-validation-design.md](superpowers/specs/2026-10-16-selection-criteria-validation-design.md)
- 화면 목업: [docs/design/2026-10-11-mockups.html](design/2026-10-11-mockups.html)
- 구현 계획: [docs/superpowers/plans/2026-10-11-gazua.md](superpowers/plans/2026-10-11-gazua.md)
- 시뮬레이션 구현 계획: [docs/superpowers/plans/2026-10-12-backtest-simulation.md](superpowers/plans/2026-10-12-backtest-simulation.md)
- 내 성과 구현 계획: [docs/superpowers/plans/2026-10-23-account-performance.md](superpowers/plans/2026-10-23-account-performance.md)
- 서버·DB 도입 검토: [docs/proposals/2026-10-25-server-and-db.md](proposals/2026-10-25-server-and-db.md)
- 동기화·공유 1단계 구현 계획: [docs/superpowers/plans/2026-10-25-sync-phase1.md](superpowers/plans/2026-10-25-sync-phase1.md)
- 카카오·네이버 로그인 구현 계획: [docs/superpowers/plans/2026-10-29-kakao-naver-login.md](superpowers/plans/2026-10-29-kakao-naver-login.md)
- 시뮬레이션 화면 리뷰와 처리 결과: [docs/design/2026-10-13-simulation-ui-review.md](design/2026-10-13-simulation-ui-review.md)
- 실연결 점검 목록: [docs/live-check.md](live-check.md)
- 프록시: [proxy/README.md](../proxy/README.md)
- 초기 PoC: [poc/gazua-poc.html](../poc/gazua-poc.html)
- 모션 데모: [motion/README.md](../motion/README.md)
