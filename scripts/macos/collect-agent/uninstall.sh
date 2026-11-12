#!/bin/bash
# 에이전트만 제거하고 설정·로그·데이터는 남겨요.
set -euo pipefail
LABEL=com.gazua.collect.extend
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="${XDG_CONFIG_HOME:-$HOME/.config}/gazua"
echo '예약 수집 에이전트를 제거했어요. 설정·로그·시장 데이터는 남겨 두었어요:'
printf '%s\n' "$DIR/collect.env" "$HOME/Library/Logs/gazua/collect.log"
