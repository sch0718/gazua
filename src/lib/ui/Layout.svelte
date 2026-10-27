<script lang="ts">
  import type { Snippet } from 'svelte';

  // 반응형 틀(스펙 7.6):
  //  <600, 그리고 1024 미만의 세로 화면: 한 열(bar → main → side),
  //  600–1023 가로: main(차트) 2/3 + side 1/3,
  //  ≥1024: 레일 240px | main | side 320px. 레일은 1024 미만에서 숨긴다. side가 없으면 그 열을 비우지 않는다.
  //  barWrap: 폰 폭(<600)에서 앱 바가 두 줄로 넘어갈 수 있다(비교 화면의 그룹 탭이 아래 줄을 쓴다).
  let {
    rail,
    bar,
    main,
    side,
    barWrap = false,
  }: { rail?: Snippet; bar?: Snippet; main: Snippet; side?: Snippet; barWrap?: boolean } = $props();
</script>

<div class="app" class:no-side={!side}>
  {#if rail}<nav class="rail" aria-label="탐색">{@render rail()}</nav>{/if}
  {#if bar}<header class="bar" class:wrap={barWrap}>{@render bar()}</header>{/if}
  <main class="main">{@render main()}</main>
  {#if side}<aside class="side">{@render side()}</aside>{/if}
</div>

<style>
  .app {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'bar' 'main' 'side';
    grid-template-rows: auto 1fr auto;
    /* 넓은 PC 화면에서도 폭을 막지 않는다. 남는 폭은 가운데 열(차트)이 가져간다. 글 위주 화면은 각자 720px로 막는다. */
    width: 100%;
    flex: 1;
    min-height: 0;
  }
  .rail {
    grid-area: rail;
    display: none;
  }
  .bar {
    grid-area: bar;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px var(--gutter);
    min-height: 56px;
  }
  /* 윗줄은 상태 칩·아이콘을 오른쪽에 모으고, 아래 줄로 내려간 항목(order로 정한다)은 한 줄을 다 쓴다. */
  @media (max-width: 599px) {
    .bar.wrap {
      flex-wrap: wrap;
      justify-content: flex-end;
      row-gap: 0;
      padding-bottom: 0;
    }
  }
  .main {
    grid-area: main;
    min-width: 0;
  }
  .side {
    grid-area: side;
    min-width: 0;
    padding: 4px 8px 16px;
  }

  @media (min-width: 600px) and (orientation: landscape) {
    .app {
      grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
      grid-template-areas: 'bar bar' 'main side';
      grid-template-rows: auto 1fr;
    }
    .side {
      border-left: 1px solid var(--line);
      background: var(--surface);
    }
    .app.no-side {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'bar' 'main';
    }
  }

  @media (min-width: 1024px) {
    .app {
      grid-template-columns: 240px minmax(0, 1fr) 320px;
      grid-template-areas: 'rail bar side' 'rail main side';
      height: 100%;
    }
    .app.no-side {
      grid-template-columns: 240px minmax(0, 1fr);
      grid-template-areas: 'rail bar' 'rail main';
    }
    .rail {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 14px 10px;
      border-right: 1px solid var(--line);
      background: var(--surface);
      overflow: auto;
    }
    .main,
    .side {
      overflow: auto;
    }
  }
</style>
