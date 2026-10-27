<script lang="ts">
  // 설정 → 정보: 저작권·라이선스, 후원 링크, 오픈소스와 데이터 출처 고지.
  // 외부 스크립트(Ko-fi 위젯 등)는 CSP와 저장된 토큰 보호를 깨므로 일반 링크만 쓴다.
  import { KOFI_URL, LICENSE_URL, NOTICES_URL } from '../../about';

  let { kofiUrl = KOFI_URL }: { kofiUrl?: string } = $props();
</script>

<div class="card">
  <div class="row">
    <span>© 2026 신춘호 · 개인 비상업 용도로 무료</span>
    <a class="btn" href={LICENSE_URL} target="_blank" rel="noopener noreferrer">라이선스</a>
  </div>
  {#if kofiUrl}
    <div class="row">
      <span>도움이 됐다면 커피 한 잔 후원해 주세요. 기능은 달라지지 않아요</span>
      <a class="btn" href={kofiUrl} target="_blank" rel="noopener noreferrer">후원하기</a>
    </div>
  {/if}
  <p class="row disclaimer">가즈아는 투자 판단을 돕는 도구이고 투자 권유가 아니에요. 투자 결과의 책임은 이용자에게 있어요.</p>
  <details class="row">
    <summary>오픈소스와 데이터 출처</summary>
    <ul>
      <li>
        차트: TradingView Lightweight Charts™ — Copyright (c) 2026 TradingView, Inc.
        (<a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">tradingview.com</a>), Apache-2.0
      </li>
      <li>글꼴: Pretendard — Copyright (c) 2021 Kil Hyung-jin, SIL Open Font License 1.1</li>
      <li>시세·계좌: 각자 연결한 한국투자증권·토스증권 오픈API. 데이터의 권리는 각 증권사와 거래소에 있어요</li>
      <li>종목 목록: 한국투자증권 공개 종목 마스터</li>
      <li>
        환율·유가: Board of Governors of the Federal Reserve System (US), DEXKOUS · U.S. Energy Information
        Administration, DCOILWTICO — retrieved from FRED, Federal Reserve Bank of St. Louis
      </li>
    </ul>
    <a href={NOTICES_URL} target="_blank" rel="noopener noreferrer">전체 오픈소스 라이선스 전문</a>
  </details>
</div>

<style>
  .card {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 4px 16px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
    font-size: var(--fs-body);
  }
  .row:last-child {
    border-bottom: 0;
  }
  .disclaimer {
    color: var(--t2);
    font-size: var(--fs-sub);
  }
  details {
    display: block;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  summary {
    min-height: var(--touch);
    display: flex;
    align-items: center;
    cursor: pointer;
    color: var(--t1);
    font-size: var(--fs-body);
  }
  ul {
    margin: 4px 0 8px;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  details a {
    color: var(--t1);
  }
  .btn {
    flex: none;
    min-height: var(--touch);
    display: inline-flex;
    align-items: center;
    padding: 0 14px;
    border-radius: 12px;
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
    text-decoration: none;
  }
</style>
