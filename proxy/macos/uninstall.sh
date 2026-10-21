#!/bin/zsh
# install.sh로 설치한 프록시 LaunchAgent를 멈추고 지워요. proxy/.env와 로그는 그대로 둬요.
set -euo pipefail

LABEL=dev.gazua.proxy
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
# install.sh가 켠 자동 반영 hook을 끈다(다른 hook 경로면 그대로 둔다).
REPO_DIR=${0:A:h:h:h}
if [[ $(git -C "$REPO_DIR" config --get core.hooksPath 2>/dev/null) == .githooks ]]; then
  git -C "$REPO_DIR" config --unset core.hooksPath
fi
echo "지웠어요."
