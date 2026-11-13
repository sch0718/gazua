#!/bin/bash
# 설정 값을 출력하거나 복사하지 않아요. DRY 모드에서는 plist만 만들어요.
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$SCRIPT_DIR/../../.." && pwd)
NODE=$(command -v node) || { echo 'Node 22.13 이상이 필요해요' >&2; exit 1; }
"$NODE" -e 'const [a,b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 13)) { console.error("Node 22.13 이상이 필요해요"); process.exit(1); }'
DRY=${GAZUA_AUTO_DRY:-0}
DIR="${XDG_CONFIG_HOME:-$HOME/.config}/gazua"
AUTO_ENV=${GAZUA_AUTO_ENV:-$DIR/auto.env}
ALERT_ENV=${GAZUA_AUTO_ALERT_ENV:-$DIR/alert.env}
LOG="$HOME/Library/Logs/gazua/auto.log"
LABEL=com.gazua.auto

if [[ "$DRY" != 1 ]]; then
  if [[ ! -f "$AUTO_ENV" ]]; then
    mkdir -p "$(dirname "$AUTO_ENV")"
    (umask 077; printf 'AUTO_MODE=dry\nAUTO_STRATEGY=\n' > "$AUTO_ENV")
    chmod 600 "$AUTO_ENV"
    echo 'auto.env를 만들었어요. AUTO_STRATEGY를 채운 뒤 다시 실행해 주세요' >&2
    exit 1
  fi
  chmod 600 "$AUTO_ENV"
fi

# 파일은 실행하지 않고 node의 환경 파일 파서로만 읽어요. 전략 이름·비밀값은 내보내지 않아요.
READ_ARGS=(--input-type=commonjs)
if [[ -f "$AUTO_ENV" ]]; then READ_ARGS+=("--env-file=$AUTO_ENV"); fi
if ! INTERVAL=$("$NODE" "${READ_ARGS[@]}" -e '
  const strategy = process.env.AUTO_STRATEGY?.trim();
  if (!strategy) { console.error("AUTO_STRATEGY를 채워 주세요"); process.exit(1); }
  const interval = (process.env.AUTO_INTERVAL_MIN ?? "1").trim();
  if (!/^[1-5]$/.test(interval)) { console.error("AUTO_INTERVAL_MIN은 1~5 사이 정수여야 해요"); process.exit(1); }
  process.stdout.write(String(Number(interval) * 60));
'); then exit 1; fi

if [[ "$DRY" == 1 ]]; then
  DEST=${GAZUA_AUTO_DRY_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/gazua-auto-dry.XXXXXX")}
  mkdir -p "$DEST"
else
  [[ -f "$REPO/cli/dist/gazua.mjs" ]] || { echo 'CLI를 먼저 빌드해 주세요: corepack pnpm --filter gazua-cli build' >&2; exit 1; }
  [[ -f "$ALERT_ENV" ]] || { echo '기존 알림 설정 alert.env를 먼저 준비해 주세요' >&2; exit 1; }
  chmod 600 "$ALERT_ENV"
  DEST="$HOME/Library/LaunchAgents"
  mkdir -p "$DEST" "$(dirname "$LOG")"
fi

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/gazua-auto-stage.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
xml() {
  "$NODE" -e 'process.stdout.write(process.argv[1].replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll("\"","&quot;").replaceAll("\x27","&apos;"))' -- "$1"
}
escape_sed() { xml "$1" | sed 's/[\&|]/\\&/g'; }
PLIST="$STAGE/$LABEL.plist"
sed -e "s|__NODE__|$(escape_sed "$NODE")|g" \
    -e "s|__RUN__|$(escape_sed "$SCRIPT_DIR/run.sh")|g" \
    -e "s|__CONFIG_HOME__|$(escape_sed "${XDG_CONFIG_HOME:-$HOME/.config}")|g" \
    -e "s|__AUTO_ENV__|$(escape_sed "$AUTO_ENV")|g" \
    -e "s|__ALERT_ENV__|$(escape_sed "$ALERT_ENV")|g" \
    -e "s|__INTERVAL__|$INTERVAL|g" \
    -e "s|__LOG__|$(escape_sed "$LOG")|g" \
    "$SCRIPT_DIR/plist.template" > "$PLIST"
plutil -lint "$PLIST"

if [[ "$DRY" == 1 ]]; then
  cp "$PLIST" "$DEST/"
  echo "plist를 만들었어요: $DEST (설정·launchctl·자동 실행은 건너뛰어요)"
  exit 0
fi
rollback() {
  trap - ERR
  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
  rm -f "$DEST/$LABEL.plist"
  echo '설치에 실패해 에이전트를 내렸어요. 설정·로그·원장은 남겨 두었어요' >&2
  exit 1
}
trap rollback ERR
cp "$PLIST" "$DEST/"
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$DEST/$LABEL.plist"
trap - ERR
echo "$((INTERVAL / 60))분 간격으로 평일 장중에 판정해요. 로그: $LOG"
