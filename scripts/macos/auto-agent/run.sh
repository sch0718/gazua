#!/bin/bash
# 장중에 한 번 판정해요. 시간 확인은 node를 띄우기 전에 해요.
set -euo pipefail
export TZ=Asia/Seoul
if [[ -n ${GAZUA_AUTO_NOW:-} ]]; then
  STAMP=$(date -r "$GAZUA_AUTO_NOW" '+%u %H%M') || { echo 'GAZUA_AUTO_NOW는 시각의 초 단위 정수여야 해요' >&2; exit 1; }
else
  STAMP=$(date '+%u %H%M')
fi
read -r WEEKDAY CLOCK <<< "$STAMP"
if (( WEEKDAY > 5 || 10#$CLOCK < 905 || 10#$CLOCK > 1520 )); then exit 0; fi

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$SCRIPT_DIR/../../.." && pwd)
DIR="${XDG_CONFIG_HOME:-$HOME/.config}/gazua"
AUTO_ENV=${GAZUA_AUTO_ENV:-$DIR/auto.env}
ALERT_ENV=${GAZUA_AUTO_ALERT_ENV:-$DIR/alert.env}
NODE=${GAZUA_AUTO_NODE:-node}
[[ -f "$AUTO_ENV" && -f "$ALERT_ENV" ]] || { echo 'auto.env와 alert.env를 먼저 준비해 주세요' >&2; exit 1; }

# 실행이 끝나면 커널이 잠금을 풀어요. 직접 실행할 때도 이 스크립트를 써요.
if [[ ! -d "$DIR" ]]; then
  (umask 077; mkdir -p "$DIR"; chmod 700 "$DIR")
fi
LOCK="$DIR/.auto.lock"
if [[ ${GAZUA_AUTO_LOCKED:-} != 1 ]]; then
  STATUS=0
  GAZUA_AUTO_LOCKED=1 /usr/bin/lockf -t 0 "$LOCK" /bin/bash "$SCRIPT_DIR/run.sh" || STATUS=$?
  if [[ "$STATUS" == 75 ]]; then
    echo '다른 실행이 돌고 있어요'
    exit 0
  fi
  exit "$STATUS"
fi

cd "$REPO"
exec "$NODE" "--env-file=$ALERT_ENV" "--env-file=$AUTO_ENV" "$REPO/cli/dist/gazua.mjs" auto
