#!/bin/sh
# git pull로 프록시 코드가 바뀌면 install.sh를 다시 돌리게 저장소 hook(.githooks)을 켠다. install.sh가 끝에 부른다.
# core.hooksPath를 바꾸면 .git/hooks의 hook은 더는 불리지 않으니, 다른 hook 경로를 쓰고 있거나
# .git/hooks에 직접 둔 hook(.sample 말고 실행 가능한 파일)이 있으면 바꾸지 않고 켜는 방법만 알려 준다.
# 사용: enable-hooks.sh <저장소 경로>
set -u
repo=$1

current=$(git -C "$repo" config --get core.hooksPath 2>/dev/null)
if [ -n "$current" ]; then
  [ "$current" = .githooks ] ||
    echo "hook 경로를 이미 $current 로 쓰고 있어 프록시 자동 반영(.githooks)은 켜지 않았어요. proxy/README.md를 봐 주세요."
  exit 0
fi

hooks=$(git -C "$repo" rev-parse --git-path hooks 2>/dev/null) || exit 0
case $hooks in /*) ;; *) hooks=$repo/$hooks ;; esac
mine=
for f in "$hooks"/*; do
  case $f in *.sample) continue ;; esac
  [ -f "$f" ] && [ -x "$f" ] && mine="$mine ${f##*/}"
done
if [ -n "$mine" ]; then
  echo "git hook이 이미 있어서(${mine# }) 프록시 자동 반영(.githooks)은 켜지 않았어요. 켜려면 둘 중 하나를 해 주세요:"
  echo "  - 기존 hook이 필요 없으면: git config core.hooksPath .githooks"
  echo "  - 계속 쓰려면: .git/hooks의 post-merge·post-rewrite·post-checkout에서 .githooks의 같은 이름 hook을 \"\$@\"와 함께 불러 주세요"
  exit 0
fi

git -C "$repo" config core.hooksPath .githooks &&
  echo "git pull로 프록시 코드가 바뀌면 자동으로 다시 설치하도록 켰어요(.githooks)."
