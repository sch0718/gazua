#!/bin/bash
# 클라우드 세션(Claude Code on the web)에서만 의존성을 설치한다. 로컬 세션에서는 아무것도 하지 않는다.
# 도구(zsh·Playwright Chromium 등)는 클라우드 환경의 설정 스크립트가 맡는다(README의 `클라우드 세션`).
# 락파일이 바뀌지 않았으면 다시 설치하지 않는다. stdout은 세션 문맥에 들어가므로 설치 출력은 stderr로 보낸다.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

sha() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi; }
hash=$(cat package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc proxy/package.json "$0" | sha | cut -d' ' -f1)
stamp=node_modules/.gazua-session-install
if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$hash" ]; then
  exit 0
fi

# 공용 패키지(@sch0718/*)는 GitHub Packages에서 받는다. 토큰은 클라우드 환경의 환경 변수로 넣는다(docs/development.md).
if [ -z "${GITHUB_PACKAGES_TOKEN:-}" ]; then
  echo "GITHUB_PACKAGES_TOKEN이 없어 의존성을 설치하지 못했어요. 클라우드 환경 설정의 환경 변수에 read:packages 권한의 classic 토큰을 넣어 주세요(docs/development.md의 클라우드 세션)."
  exit 0
fi

# pnpm은 프로젝트 .npmrc의 인증 줄에서 환경변수를 풀지 않으므로 사용자 ~/.npmrc에 변수 이름만 적는다(값은 적지 않는다).
auth='//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}'
grep -qxF "$auth" ~/.npmrc 2>/dev/null || echo "$auth" >> ~/.npmrc

corepack enable >/dev/null 2>&1 || true
corepack pnpm install --frozen-lockfile >&2
echo "$hash" > "$stamp"
echo "의존성을 설치했어요(pnpm install --frozen-lockfile)."
