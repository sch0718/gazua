# 밤 예약 수집

기존 시장 파일을 매일 03:30에 1년씩 과거로 늘려요. 기본 목표는 5년이고, 목표에 닿으면 파일만 읽고 끝나요. 맥이 잠들어 있으면 깬 뒤 한 번 돌아요. 하루 한 번으로 정한 이유: 초당 1건(기본 2건의 절반)으로 1년을 늘리는 데 약 2~3시간 걸려, 하루 한 번이면 4일 만에 5년에 닿고 낮 시간의 앱·알람 토스 호출과 겹치지 않아요.

먼저 Node 22.13 이상을 설치하고, 저장소의 `.env.toss`와 owner 표시용 CLI 빌드(`corepack pnpm --filter gazua-cli build`)를 준비해 주세요. `~/gazua-data/`에 처음 수집한 `market-data-YYYYMMDD.json.gz` 파일도 있어야 해요. 설치는 첫 수집을 대신하지 않아요.

```sh
bash scripts/macos/collect-agent/install.sh
```

설치하면 `~/.config/gazua/collect.env`를 권한 600으로 만들어요(`XDG_CONFIG_HOME`을 지정했다면 그 아래에 만들어요). 이미 있는 설정은 지켜요. 키는 이 파일에 넣지 말고 저장소의 `.env.toss`에만 두세요.

```sh
GAZUA_COLLECT_DIR=$HOME/gazua-data
GAZUA_COLLECT_MAX_YEARS=5
GAZUA_COLLECT_RATE=1
```

설치는 `com.gazua.collect.extend` 에이전트를 등록하고, 바로 수집하지는 않아요. 로그는 `~/Library/Logs/gazua/collect.log`에 모아요. Node 경로는 설치할 때 정해요. Node나 저장소를 옮겼다면 다시 설치해 주세요.

설치 없이 plist만 확인하려면 DRY 모드를 써요. 설정·로그를 만들거나 launchd에 등록하지 않고, 임시 폴더에 plist만 만들어 검사해요. 실제 키 파일이나 CLI 빌드 없이도 시험할 수 있어요.

```sh
GAZUA_COLLECT_DRY=1 bash scripts/macos/collect-agent/install.sh
```

한 번 직접 실행할 때는 `bash scripts/macos/collect-agent/run.sh`를 써요. 어디에서 실행해도 저장소 경로를 찾아요. 가장 새 시장 파일을 고르고, 살아 있는 다른 실행이 있으면 잠금을 지키고 끝나요. 잠금은 데이터 폴더의 `.collect-extend.lock`을 macOS `lockf`로 잡아요. 실행이 끝나거나 죽으면 저절로 풀려요.

늘리기가 끝나면 이전 파일은 `market-data-backup.json.gz.bak` 하나로 남아요. 드물게 바꾸는 도중에 멈추면 `.bak`과 `market-data-YYYYMMDD.json.gz.tmp`만 남을 수 있어요. 이때는 `.tmp`의 끝 `.tmp`를 지워 이름을 바꿔 주세요. 토스로 수집한 파일만 늘려요(KIS 파일이면 거부해요). 수정주가가 달라 늘리지 못한 종목은 로그로 알려 줘요. 이때는 새로 수집해 주세요. 새 종목이나 최근 일봉을 더하려면 기존 `--update`를 써요.

```sh
bash scripts/macos/collect-agent/uninstall.sh
```

제거해도 설정·로그·시장 데이터는 남겨 두어요.
