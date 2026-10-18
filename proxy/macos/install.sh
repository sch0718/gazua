#!/bin/zsh
# 맥 로그인 때 프록시를 자동으로 띄우는 LaunchAgent를 설치해요. 다시 실행하면 새로 빌드하고 재시작해요.
# 프록시 토큰은 proxy/.env에서 읽고 plist에는 경로만 적어요.
set -euo pipefail

LABEL=dev.gazua.proxy
PROXY_DIR=${0:A:h:h}
REPO_DIR=${PROXY_DIR:h}
ENV_FILE=$PROXY_DIR/.env
PLIST=$HOME/Library/LaunchAgents/$LABEL.plist
LOG=$HOME/Library/Logs/gazua-proxy.log

if ! grep -Eq '^PROXY_TOKEN=.+' "$ENV_FILE" 2>/dev/null || ! grep -Eq '^ALLOWED_ORIGINS=.+' "$ENV_FILE"; then
  echo "proxy/.env에 ALLOWED_ORIGINS와 PROXY_TOKEN을 먼저 채워 주세요." >&2
  exit 1
fi

# nvm 버전 경로는 바뀌므로 Homebrew의 고정 경로를 먼저 써요. --env-file은 Node 20.6 이상이 필요해요(저장소 기준 22).
NODE=/opt/homebrew/bin/node
[[ -x $NODE ]] || NODE=$(command -v node)
if (( ${${$("$NODE" --version)#v}%%.*} < 22 )); then
  echo "Node 22 이상이 필요해요: $NODE ($("$NODE" --version))" >&2
  exit 1
fi

(cd "$REPO_DIR" && corepack pnpm --filter proxy build)

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
if lsof -nP -iTCP:8787 -sTCP:LISTEN >/dev/null; then
  echo "8787 포트를 다른 프로세스가 쓰고 있어요. 터미널에서 띄운 프록시를 먼저 멈춰 주세요(Ctrl-C)." >&2
  exit 1
fi

mkdir -p "${PLIST:h}" "${LOG:h}"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--env-file=$ENV_FILE</string>
    <string>$PROXY_DIR/dist/node/server.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$UID" "$PLIST"

for _ in {1..10}; do
  if curl -fsS -m 2 http://localhost:8787/health >/dev/null 2>&1; then
    echo "설치했어요. 로그: $LOG"
    exit 0
  fi
  sleep 1
done
echo "프록시가 10초 안에 응답하지 않았어요. 로그를 확인해 주세요: $LOG" >&2
exit 1
