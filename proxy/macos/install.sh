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

# nvm 버전 경로는 바뀌므로 Homebrew의 고정 경로를 먼저 써요. --env-file은 Node 20.6 이상이 필요해요(저장소 기준 22).
NODE=/opt/homebrew/bin/node
[[ -x $NODE ]] || NODE=$(command -v node)
if (( ${${$("$NODE" --version)#v}%%.*} < 22 )); then
  echo "Node 22 이상이 필요해요: $NODE ($("$NODE" --version))" >&2
  exit 1
fi

# 프록시와 같은 파서(node --env-file)로 읽은 값을 검사해요. `PROXY_TOKEN=""`나 주석만 있는 줄은 빈 값이라
# 프록시가 토큰 검사를 끈 채로 떠요. 통과하면 첫 번째 허용 출처를 출력해 아래 인증 확인에 써요.
# --env-file은 이미 있는 환경변수를 덮어쓰지 않으니, 셸에 export된 값이 파일의 빈 값을 가리지 않게 env -i로 비워요.
# LaunchAgent도 셸 환경 없이 파일 값만으로 떠요.
if [[ ! -f $ENV_FILE ]] || ! ORIGIN=$(env -i "$NODE" --env-file="$ENV_FILE" -e '
  const t = (process.env.PROXY_TOKEN ?? "").trim();
  const o = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!t || !o.length) process.exit(1);
  console.log(o[0]);
'); then
  echo "proxy/.env에 ALLOWED_ORIGINS와 PROXY_TOKEN을 먼저 채워 주세요(빈 값·따옴표만 있는 값은 안 돼요)." >&2
  exit 1
fi

(cd "$REPO_DIR" && corepack pnpm --filter proxy build)

# 경로에 &·< 같은 문자가 있어도 plist가 깨지지 않게 XML로 이스케이프해요.
xml() {
  local s=$1
  s=${s//&/&amp;}
  s=${s//</&lt;}
  s=${s//>/&gt;}
  print -r -- "$s"
}

# 기존 서비스를 내리기 전에 새 plist가 올바른지 먼저 확인해요.
mkdir -p "${PLIST:h}" "${LOG:h}"
TMP=$(mktemp -t gazua-proxy-plist)
trap 'rm -f "$TMP"' EXIT
cat > "$TMP" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE")</string>
    <string>--env-file=$(xml "$ENV_FILE")</string>
    <string>$(xml "$PROXY_DIR/dist/node/server.js")</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG")</string>
</dict>
</plist>
EOF
plutil -lint -s "$TMP"

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
if lsof -nP -iTCP:8787 -sTCP:LISTEN >/dev/null; then
  echo "8787 포트를 다른 프로세스가 쓰고 있어요. 터미널에서 띄운 프록시를 먼저 멈춰 주세요(Ctrl-C)." >&2
  exit 1
fi

mv "$TMP" "$PLIST"
launchctl bootstrap "gui/$UID" "$PLIST"

for _ in {1..10}; do
  if curl -fsS -m 2 http://localhost:8787/health >/dev/null 2>&1; then
    # /health는 토큰 없이도 200이라, 토큰 없는 시세 요청을 프록시가 직접 막는지도 확인해요.
    # 인증이 꺼져 있으면 요청이 상류로 가고 상류의 401이 그대로 오므로, 상태 코드만이 아니라 프록시의 오류 코드를 봐요.
    resp=$(curl -s -w $'\n%{http_code}' -m 5 -H "Origin: $ORIGIN" http://localhost:8787/toss/api/v1/prices || true)
    code=${resp##*$'\n'}
    body=${resp%$'\n'*}
    if [[ $code != 401 || $body != *'"code":"proxy-token-invalid"'* ]]; then
      launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
      echo "토큰 없는 요청을 프록시가 막지 않았어요(응답 $code). 서비스를 내렸어요. proxy/.env의 PROXY_TOKEN을 확인해 주세요." >&2
      exit 1
    fi
    # git pull로 프록시 코드가 바뀌면 이 스크립트를 다시 돌리게 저장소 hook(.githooks)을 켠다.
    # 다른 hook 경로나 .git/hooks의 hook을 이미 쓰고 있으면 건드리지 않고 방법만 알려 준다.
    sh "${0:A:h}/enable-hooks.sh" "$REPO_DIR" || true
    echo "설치했어요. 로그: $LOG"
    exit 0
  fi
  sleep 1
done
echo "프록시가 10초 안에 응답하지 않았어요. 로그를 확인해 주세요: $LOG" >&2
exit 1
