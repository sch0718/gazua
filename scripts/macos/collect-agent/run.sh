#!/bin/bash
# 가장 새 시장 파일을 1년씩 과거로 늘려요. 키 값은 읽거나 출력하지 않아요.
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$SCRIPT_DIR/../../.." && pwd)
cd "$REPO"
ENV_FILE=${GAZUA_COLLECT_ENV:-${XDG_CONFIG_HOME:-$HOME/.config}/gazua/collect.env}
if [[ -f "$ENV_FILE" ]]; then source "$ENV_FILE"; fi
DATA_DIR=${GAZUA_COLLECT_DIR:-$HOME/gazua-data}
MAX_YEARS=${GAZUA_COLLECT_MAX_YEARS:-5}
RATE=${GAZUA_COLLECT_RATE:-1}
NODE=${GAZUA_COLLECT_NODE:-node}
mkdir -p "$DATA_DIR"
DATA_DIR=$(cd "$DATA_DIR" && pwd)

# 잠금: macOS lockf로 잠금 파일을 잡은 채 자신을 다시 실행해요. 프로세스가 끝나면 커널이 풀어 주므로 남은 잠금을 치울 일이 없어요.
LOCK="$DATA_DIR/.collect-extend.lock"
if [[ ${GAZUA_COLLECT_LOCKED:-} != 1 ]]; then
  STATUS=0
  GAZUA_COLLECT_LOCKED=1 /usr/bin/lockf -t 0 "$LOCK" /bin/bash "$SCRIPT_DIR/run.sh" || STATUS=$?
  # lockf는 잠금을 잡지 못하면 75(EX_TEMPFAIL)로 끝나요
  if [[ "$STATUS" == 75 ]]; then
    echo '다른 실행이 돌고 있어요'
    exit 0
  fi
  exit "$STATUS"
fi

shopt -s nullglob
LATEST=''
for FILE in "$DATA_DIR"/market-data-*.json.gz; do
  [[ -f "$FILE" ]] && LATEST="$FILE"
done
if [[ -z "$LATEST" ]]; then
  echo '먼저 수집해 주세요' >&2
  exit 1
fi
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 과거로 늘려요: $LATEST"
"$NODE" "--env-file=$REPO/.env.toss" "$REPO/scripts/collect-market-data.mjs" \
  --provider toss --extend-back "$LATEST" --years 1 --max-years "$MAX_YEARS" --rate "$RATE" --out "$DATA_DIR"
