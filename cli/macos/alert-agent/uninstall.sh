#!/bin/bash
# 에이전트만 제거하고 설정·기록·로그는 남긴다.
set -euo pipefail
for SUB in premarket watch; do
  LABEL="com.gazua.alert.$SUB"
  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
done
DIR="${XDG_CONFIG_HOME:-$HOME/.config}/gazua"
echo '알람 에이전트를 제거했어요. 다음 파일은 남겨 두었어요:'
printf '%s\n' "$DIR/alert.env" "$DIR/alerts/" "$HOME/Library/Logs/gazua/alert.log"
