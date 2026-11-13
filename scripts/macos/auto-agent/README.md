# 전략 예약 실행

`gazua auto`를 맥에서 1~5분마다 한 번 실행해요. KST 월~금 09:05~15:20 밖에서는 node를 띄우지 않고, 휴장일은 CLI가 네이버 장 상태로 건너뛰어요. 매수는 15:15 전에만 판정해요.

Node 22.13 이상과 CLI 빌드가 필요해요. 먼저 `gazua login`으로 동기화한 프로필을 연결하고, 기존 알림 설정 `~/.config/gazua/alert.env`를 준비해 주세요. `XDG_CONFIG_HOME`이 있으면 그 아래 `gazua` 디렉터리를 써요.

```sh
corepack pnpm --filter gazua-cli build
bash scripts/macos/auto-agent/install.sh
```

`auto.env`가 없으면 `AUTO_MODE=dry`와 빈 `AUTO_STRATEGY=`만 권한 600으로 만들고 설치를 멈춰요. 전략 이름 또는 ID를 채운 뒤 설치 명령을 다시 실행해 주세요. 기본 간격은 1분이며 `auto.env`의 `AUTO_INTERVAL_MIN`을 1~5로 지정할 수 있어요. 간격을 바꾸면 다시 설치해요. 설정을 실행 가능한 셸 코드로 읽지 않아요.

기본은 연습이에요. 실전 전환은 사용자가 `AUTO_MODE=live`로 바꿔 승인해요. 실전 키·프록시 설정은 [CLI 자동 실행기 안내](../../../cli/README.md#자동-실행기)를 따라 환경변수로 준비하고, 저장소·로그·원장에 복사하지 마세요. 알림 토픽은 기존 `alert.env`를 읽으며 별도 파일에 복사하지 않아요. 두 환경 파일은 권한 600을 유지해요.

실전 원장은 `auto-positions.json`, 연습 원장은 `auto-positions.dry.json`으로 분리돼요. 주문을 보내기 전에 원장을 기록하므로 임의로 지우면 중복 실행을 막던 기록이 사라져요. 같은 전략의 규칙을 앱에서 고치면 남은 포지션에도 적용돼요. 결과 불명·미체결 알림은 토스 앱에서 직접 확인해 주세요. 투자 조언 아님.

설치 전에 plist만 확인하려면 아래처럼 실행해요. 설정·로그·LaunchAgents를 만들지 않고 임시 디렉터리의 plist만 검사해요. 기존 `auto.env`가 없다면 환경변수로 전략을 지정해 주세요.

```sh
GAZUA_AUTO_DRY=1 AUTO_STRATEGY='전략 이름' bash scripts/macos/auto-agent/install.sh
```

등록 라벨은 `com.gazua.auto`, 로그는 `~/Library/Logs/gazua/auto.log`예요. Node와 저장소 경로는 설치할 때 정하므로 옮기면 다시 설치해요. 맥이 잠든 동안 실행하지 못한 판정은 깨운 뒤의 현재 시각을 기준으로 해요.

한 번 직접 실행할 때도 원장을 공유하는 다른 실행과 겹치지 않도록 아래 스크립트를 써요. 설정 디렉터리의 `.auto.lock`을 `lockf -t 0`으로 잠그고, 다른 실행이 돌고 있으면 종료해요.

```sh
bash scripts/macos/auto-agent/run.sh
```

시험에서는 `GAZUA_AUTO_NOW`에 epoch 초를 넣어 시각을 바꿀 수 있어요. `GAZUA_AUTO_ENV`·`GAZUA_AUTO_ALERT_ENV`는 환경 파일 경로, `GAZUA_AUTO_NODE`는 Node 경로를 바꿔요. 운영 때는 시각을 덮어쓰지 마세요.

실전 주문을 즉시 막으려면 프록시의 `ORDER_STOP_FILE` 경로에 중지 파일을 만들어요. 예약 작업을 제거하려면 아래 명령을 실행해요. 설정·로그·원장은 남겨 두어요.

```sh
bash scripts/macos/auto-agent/uninstall.sh
```
