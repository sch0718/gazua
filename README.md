# 가즈아

관심종목을 한 차트에 나란히 놓고 비교하는 모바일 우선 웹앱입니다. GitHub Pages에 정적 사이트로 배포하고, 시세는 증권사 Open API(한국투자증권·토스증권)에서 받아옵니다.

- 일·주(1~4)·월(1~6)·년 단위 기간 전환
- 등락률 기본 비교 + 고점 대비 하락률, 시장 대비 초과수익, 상대 거래량, 시가총액
- KRX/NXT 전환. 자동 모드는 **KRX 우선**(KRX가 거래 중이면 KRX, 아니면 NXT)
- 종목별 거래 불가 시간 표시
- 설정과 API 키는 각자 브라우저(localStorage)에만 저장

## 문서

- 설계: [docs/superpowers/specs/2026-10-11-stock-compare-design.md](docs/superpowers/specs/2026-10-11-stock-compare-design.md)
- 화면 목업: [docs/design/2026-10-11-mockups.html](docs/design/2026-10-11-mockups.html)
- 구현 계획: [docs/superpowers/plans/2026-10-11-gazua.md](docs/superpowers/plans/2026-10-11-gazua.md)
