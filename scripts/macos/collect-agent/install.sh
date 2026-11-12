#!/bin/bash
# 밤 예약 수집을 설치해요. DRY 모드에서는 임시 경로에 plist만 만들어요.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$SCRIPT_DIR/../../.." && pwd)
NODE=$(command -v node) || { echo 'Node 22.13 이상이 필요해요' >&2; exit 1; }
"$NODE" -e 'const [a,b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 13)) { console.error("Node 22.13 이상이 필요해요"); process.exit(1); }'
DRY=${GAZUA_COLLECT_DRY:-0}
DIR="${XDG_CONFIG_HOME:-$HOME/.config}/gazua"
ENV_FILE="$DIR/collect.env"
LOG="$HOME/Library/Logs/gazua/collect.log"
LABEL=com.gazua.collect.extend

if [[ "$DRY" == 1 ]]; then
  DEST=${GAZUA_COLLECT_DRY_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/gazua-collect-dry.XXXXXX")}
  mkdir -p "$DEST"
else
  [[ -f "$REPO/.env.toss" ]] || { echo '저장소에 .env.toss를 먼저 만들어 주세요' >&2; exit 1; }
  [[ -f "$REPO/cli/dist/gazua.mjs" ]] || { echo 'CLI를 먼저 빌드해 주세요: corepack pnpm --filter gazua-cli build' >&2; exit 1; }
  DEST="$HOME/Library/LaunchAgents"
  mkdir -p "$DIR"
  if [[ ! -f "$ENV_FILE" ]]; then
    (
      umask 077
      cat > "$ENV_FILE" <<'CONFIG'
GAZUA_COLLECT_DIR=$HOME/gazua-data
GAZUA_COLLECT_MAX_YEARS=5
GAZUA_COLLECT_RATE=1
CONFIG
    )
  fi
  chmod 600 "$ENV_FILE"
  mkdir -p "$DEST" "$(dirname "$LOG")"
fi

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/gazua-collect-stage.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
xml() {
  "$NODE" -e 'process.stdout.write(process.argv[1].replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll("\"","&quot;").replaceAll("\x27","&apos;"))' -- "$1"
}
escape_sed() { xml "$1" | sed 's/[\&|]/\\&/g'; }
PLIST="$STAGE/$LABEL.plist"
sed -e "s|__NODE__|$(escape_sed "$NODE")|g" \
    -e "s|__RUN__|$(escape_sed "$SCRIPT_DIR/run.sh")|g" \
    -e "s|__ENV__|$(escape_sed "$ENV_FILE")|g" \
    -e "s|__LOG__|$(escape_sed "$LOG")|g" \
    "$SCRIPT_DIR/plist.template" > "$PLIST"
plutil -lint "$PLIST"

if [[ "$DRY" == 1 ]]; then
  cp "$PLIST" "$DEST/"
  echo "plist를 만들었어요: $DEST (설정·launchctl·수집은 건너뛰어요)"
  exit 0
fi
rollback() {
  trap - ERR
  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
  rm -f "$DEST/$LABEL.plist"
  echo '설치에 실패해 에이전트를 내렸어요. 설정·로그·데이터는 남겨 두었어요' >&2
  exit 1
}
trap rollback ERR
cp "$PLIST" "$DEST/"
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$DEST/$LABEL.plist"
trap - ERR
echo "매일 03:30에 수집해요. 지금 바로 실행하지는 않아요. 로그: $LOG"
