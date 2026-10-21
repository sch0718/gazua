#!/bin/bash
# 클라우드 세션(Claude Code on the web)에서만 의존성을 설치한다. 로컬 세션에서는 아무것도 하지 않는다.
# 도구(zsh·Playwright Chromium 등)는 클라우드 환경의 설정 스크립트가 맡는다(README의 `클라우드 세션`).
# 락파일이 바뀌지 않았으면 다시 설치하지 않는다. stdout은 세션 문맥에 들어가므로 설치 출력은 stderr로 보낸다.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

sha() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi; }
hash=$(cat package.json pnpm-lock.yaml pnpm-workspace.yaml proxy/package.json "$0" | sha | cut -d' ' -f1)
stamp=node_modules/.gazua-session-install
if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$hash" ]; then
  exit 0
fi

corepack enable >/dev/null 2>&1 || true
corepack pnpm install --frozen-lockfile >&2
echo "$hash" > "$stamp"
echo "의존성을 설치했어요(pnpm install --frozen-lockfile)."
