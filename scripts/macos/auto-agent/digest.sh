#!/bin/bash
# 저녁 요약을 한 번 보내요. 날짜·시간과 중복 전송은 CLI가 확인해요.
set -euo pipefail
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
LOCK="$DIR/.auto-digest.lock"
if [[ ${GAZUA_AUTO_DIGEST_LOCKED:-} != 1 ]]; then
  STATUS=0
  GAZUA_AUTO_DIGEST_LOCKED=1 /usr/bin/lockf -t 0 "$LOCK" /bin/bash "$SCRIPT_DIR/digest.sh" || STATUS=$?
  if [[ "$STATUS" == 75 ]]; then
    echo '다른 실행이 돌고 있어요'
    exit 0
  fi
  exit "$STATUS"
fi

cd "$REPO"
exec "$NODE" "--env-file=$ALERT_ENV" "--env-file=$AUTO_ENV" "$REPO/cli/dist/gazua.mjs" auto digest
