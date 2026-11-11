#!/bin/bash
# 해외 지표 알람 에이전트를 설치한다. DRY 모드는 임시 경로에 plist만 만든다.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$SCRIPT_DIR/../../.." && pwd)
NODE=$(command -v node) || { echo 'Node 22.13 이상이 필요해요' >&2; exit 1; }
"$NODE" -e 'const [a,b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 13)) { console.error("Node 22.13 이상이 필요해요"); process.exit(1); }'
CLI="$REPO/cli/dist/gazua.mjs"
DRY=${GAZUA_ALERT_DRY:-0}
[[ "$DRY" == 1 || -f "$CLI" ]] || { echo 'CLI를 먼저 빌드해 주세요: corepack pnpm --filter gazua-cli build' >&2; exit 1; }
DIR="${XDG_CONFIG_HOME:-$HOME/.config}/gazua"
ENV="$DIR/alert.env"
LOG="$HOME/Library/Logs/gazua/alert.log"
PROFILE=''
SYMBOLS=''
while (( $# )); do
  case "$1" in
    --symbols|--profile)
      [[ $# -ge 2 && -n "$2" ]] || { echo '옵션 값이 빠졌어요' >&2; exit 2; }
      if [[ "$1" == --symbols ]]; then SYMBOLS=$2; else PROFILE=$2; fi
      shift 2 ;;
    *) echo '사용법: install.sh [--symbols 000660,005930] [--profile ID]' >&2; exit 2 ;;
  esac
done
if [[ -n "$SYMBOLS" && ! "$SYMBOLS" =~ ^[0-9]{6}(,[0-9]{6})*$ ]]; then
  echo '--symbols는 쉼표로 구분한 6자리 종목 코드여야 해요' >&2
  exit 2
fi

if [[ "$DRY" == 1 ]]; then
  DEST=${GAZUA_ALERT_DRY_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/gazua-alert-dry.XXXXXX")}
  mkdir -p "$DEST"
else
  DEST="$HOME/Library/LaunchAgents"
  if [[ ! -f "$ENV" ]]; then
    mkdir -p "$DIR"
    (
      umask 077
      # pipefail 아래 tr | head의 SIGPIPE를 피하고 같은 문자 집합에서 24자를 고른다.
      TOPIC=$("$NODE" -e 'const {randomInt}=require("node:crypto"); const chars="abcdefghijklmnopqrstuvwxyz0123456789"; console.log("gazua-"+Array.from({length:24},()=>chars[randomInt(chars.length)]).join(""))')
      cat > "$ENV" <<CONFIG
GAZUA_ALERT_NTFY_TOPIC=$TOPIC
GAZUA_ALERT_NTFY_SERVER=https://ntfy.sh
GAZUA_ALERT_SPIKE_SIGMA=2.5
GAZUA_ALERT_COOLDOWN_MIN=0
GAZUA_ALERT_DAILY_MAX=0
GAZUA_ALERT_TOP=5
CONFIG
    )
  fi
  chmod 600 "$ENV"
  if [[ -z "$SYMBOLS" && -z "$PROFILE" ]]; then
    HINT='gazua login을 하거나 --symbols를 지정해 주세요'
    if ! PROFILES=$("$NODE" "$CLI" profiles); then
      printf '%s\n' "$PROFILES" >&2
      echo "프로필 목록을 가져오지 못했어요. $HINT" >&2
      exit 1
    fi
    COUNT=$(printf '%s' "$PROFILES" | "$NODE" -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const r=JSON.parse(s);if(!r.ok||!Array.isArray(r.data?.profiles))process.exit(1);console.log(r.data.profiles.length)})') || {
      printf '%s\n' "$PROFILES" >&2
      echo "프로필 응답을 읽지 못했어요. $HINT" >&2
      exit 1
    }
    if (( COUNT == 0 )); then echo '프로필이 없어요. --symbols를 지정하거나 앱에서 프로필을 동기화해 주세요' >&2; exit 1; fi
    if (( COUNT >= 2 )); then
      printf '%s' "$PROFILES" | "$NODE" -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{for(const p of JSON.parse(s).data.profiles)console.log(`${p.id}\t${p.name}`)})'
      read -r -p '알람에 쓸 프로필 ID: ' PROFILE
      printf '%s' "$PROFILES" | "$NODE" -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{if(!JSON.parse(s).data.profiles.some(p=>p.id===process.argv[1])){console.error("목록에 있는 프로필 ID를 골라 주세요");process.exit(1)}})' -- "$PROFILE"
    fi
  fi
  mkdir -p "$DEST" "$(dirname "$LOG")"
fi

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/gazua-alert-stage.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
xml() {
  "$NODE" -e 'process.stdout.write(process.argv[1].replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll("\"","&quot;").replaceAll("\x27","&apos;"))' -- "$1"
}
escape_sed() { xml "$1" | sed 's/[\&|]/\\&/g'; }
ARGS=()
if [[ -n "$SYMBOLS" ]]; then ARGS=(--symbols "$SYMBOLS"); elif [[ -n "$PROFILE" ]]; then ARGS=(--profile "$PROFILE"); fi
: > "$STAGE/args.xml"
if [[ -n "$SYMBOLS" || -n "$PROFILE" ]]; then
  for ARG in "${ARGS[@]}"; do printf '    <string>%s</string>\n' "$(xml "$ARG")" >> "$STAGE/args.xml"; done
fi
for SUB in premarket watch; do
  SCHEDULE="$STAGE/$SUB.xml"
  : > "$SCHEDULE"
  for WEEKDAY in 1 2 3 4 5; do
    if [[ "$SUB" == premarket ]]; then FIRST=520; LAST=520; else FIRST=550; LAST=920; fi
    for (( MINUTE=FIRST; MINUTE<=LAST; MINUTE+=10 )); do
      cat >> "$SCHEDULE" <<CALENDAR
    <dict>
      <key>Weekday</key><integer>$WEEKDAY</integer>
      <key>Hour</key><integer>$((MINUTE / 60))</integer>
      <key>Minute</key><integer>$((MINUTE % 60))</integer>
    </dict>
CALENDAR
    done
  done
  sed -e "s|__NODE__|$(escape_sed "$NODE")|g" \
      -e "s|__CLI__|$(escape_sed "$CLI")|g" \
      -e "s|__ENV__|$(escape_sed "$ENV")|g" \
      -e "s|__LOG__|$(escape_sed "$LOG")|g" \
      -e "s|__LABEL__|com.gazua.alert.$SUB|g" \
      -e "s|__SUBCOMMAND__|$SUB|g" \
      -e "/__PROFILE_ARGS__/r $STAGE/args.xml" -e '/__PROFILE_ARGS__/d' \
      -e "/__SCHEDULE__/r $SCHEDULE" -e '/__SCHEDULE__/d' \
      "$SCRIPT_DIR/plist.template" > "$STAGE/com.gazua.alert.$SUB.plist"
  plutil -lint "$STAGE/com.gazua.alert.$SUB.plist"
done

if [[ "$DRY" == 1 ]]; then
  cp "$STAGE/"*.plist "$DEST/"
  echo "plist를 만들었어요: $DEST (launchctl·시험 발송 생략)"
  exit 0
fi
rollback() {
  trap - ERR
  for SUB in premarket watch; do
    launchctl bootout "gui/$UID/com.gazua.alert.$SUB" 2>/dev/null || true
    rm -f "$DEST/com.gazua.alert.$SUB.plist"
  done
  echo '설치에 실패해 두 에이전트를 내렸어요. 설정·기록은 남겨 두었어요' >&2
  exit 1
}
trap rollback ERR
for SUB in premarket watch; do
  cp "$STAGE/com.gazua.alert.$SUB.plist" "$DEST/"
  launchctl bootout "gui/$UID/com.gazua.alert.$SUB" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$DEST/com.gazua.alert.$SUB.plist"
done
"$NODE" "$CLI" alert test --env-file "$ENV"
trap - ERR
# 토픽은 구독 안내를 위해 이 터미널에서만 한 번 보여 준다.
"$NODE" -e 'const {parseEnv}=require("node:util");const {readFileSync}=require("node:fs");console.log(parseEnv(readFileSync(process.argv[1],"utf8")).GAZUA_ALERT_NTFY_TOPIC ?? "")' -- "$ENV"
echo '휴대폰 ntfy 앱에서 이 토픽을 구독하세요'
echo "설치했어요. 로그: $LOG"
