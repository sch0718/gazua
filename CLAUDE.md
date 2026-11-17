# gazua 작업 규칙

## 웹 플랫폼 가이드 (Modern Web Guidance)

HTML·CSS·브라우저 JS를 만들거나 고칠 때는 Chrome·Edge·Firefox·MDN 팀이 관리하는 [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance) 스킬을 씁니다. `.claude/settings.json`이 플러그인 `modern-web-guidance@googlechrome`을 켭니다(처음 열 때 마켓플레이스 신뢰를 묻습니다). 서버·파이프라인·빌드 설정·시험 코드 작업에는 쓰지 않습니다.

- **대상:** `src/`(Svelte 5 PWA), `index.html`, `auth/callback/`. `sync-worker/`, `proxy/`, `cli/`, `scripts/`, `motion/`은 대상이 아닙니다.
- **개발:** 화면·CSS·클라이언트 JS 작업을 시작할 때 먼저 가이드를 찾아 읽고 구현합니다. 직접 만들거나 라이브러리를 더하기 전에 같은 일을 하는 웹 표준 기능(`<dialog>`, popover, anchor positioning, `light-dark()`, `field-sizing` 등)이 있는지 확인합니다. 가이드는 바닐라 HTML/CSS/JS 기준이므로 Svelte 5에 맞게 옮기되 최신 기능은 버리지 않습니다. 검색어는 기능을 뜻하는 영어 2~5단어로 쓰고, 기능이 여럿이면 나눠 찾습니다.

  ```sh
  DISABLE_TELEMETRY=1 pnpx modern-web-guidance@latest search "light dismiss dialog"
  DISABLE_TELEMETRY=1 pnpx modern-web-guidance@latest retrieve "<id>[,<id>...]"
  ```

- **점검:** 화면을 넓게 바꾼 PR, 릴리스 전, 정기 점검 때 `legacy-scan`으로 옛 패턴을 찾습니다. 결과는 후보일 뿐이므로 항목마다 규칙의 `keepWhen`/`dropWhen`으로 확인하고, 일부러 둔 대체 코드·외부(vendor) 코드·비슷해 보이기만 하는 코드는 고치지 않습니다. 확인한 것만 고치고 같은 경로를 다시 스캔합니다. 스캔 규칙은 전체 가이드의 약 20%에만 있으므로 0건이 곧 최신이라는 뜻은 아닙니다. 기능 하나를 고칠 때는 스캔하지 않고 위 「개발」 순서를 따릅니다.

  ```sh
  DISABLE_TELEMETRY=1 pnpx modern-web-guidance@latest legacy-scan <경로> --json
  ```

- **브라우저 지원:** Baseline Widely available 기능은 대체 코드 없이 씁니다. 그보다 새 기능은 가이드의 대체 방법을 따르되, 폴리필 패키지보다 기능 감지와 짧은 대체 코드를 먼저 고릅니다. 휴대폰 사용자가 많으므로 iOS Safari 지원을 꼭 확인합니다. Origin Trial·변동성 기능(`.mwgrc`의 `allowOriginTrials`·`allowVolatileFeatures`)은 켜지 않습니다.
- **한글 입력:** Enter로 저장·제출하는 입력은 IME 조합 중(`event.isComposing`)이면 무시합니다(가이드 `ime-safe-enter-submit`). 조합 중 Enter를 처리하면 마지막 글자가 빠지거나 두 번 저장됩니다.
- **텔레메트리:** 이 CLI는 기본으로 검색어와 가이드 ID를 Google에 보냅니다. 명령 앞에 늘 `DISABLE_TELEMETRY=1`을 붙이고, 검색어에는 일반적인 UI 기능 이름만 쓰며 저장소 내용을 넣지 않습니다.
