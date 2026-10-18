#!/bin/zsh
# install.sh로 설치한 프록시 LaunchAgent를 멈추고 지워요. proxy/.env와 로그는 그대로 둬요.
set -euo pipefail

LABEL=dev.gazua.proxy
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "지웠어요."
