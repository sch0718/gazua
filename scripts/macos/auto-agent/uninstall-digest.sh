#!/bin/bash
# 에이전트만 제거하고 설정·로그·원장은 남겨요.
set -euo pipefail
LABEL=com.gazua.auto-digest
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo '저녁 요약 에이전트를 제거했어요. 설정·로그·원장은 남겨 두었어요'
