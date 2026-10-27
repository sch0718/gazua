<script lang="ts" module>
  /** 도움말에 보이는 단축키. 키 처리는 shortcuts.ts에 있다. */
  export const SHORTCUT_LIST: { keys: string[]; label: string }[] = [
    { keys: ['/'], label: '종목 검색' },
    { keys: ['[', ']'], label: '기간 이동 (짧게 · 길게)' },
    { keys: ['M'], label: '지표 선택' },
    { keys: ['V'], label: '거래소 모드 순환' },
    { keys: ['H'], label: '선택 종목 숨기기·보이기' },
    { keys: ['?'], label: '이 도움말' },
    { keys: ['Esc'], label: '시트 닫기' },
  ];
</script>

<script lang="ts">
  import { Sheet } from '@sch0718/ui-svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();
</script>

<Sheet {open} title="단축키" {onclose}>
  <dl>
    {#each SHORTCUT_LIST as s (s.label)}
      <div class="row">
        <dt>
          {#each s.keys as k (k)}<kbd>{k}</kbd>{/each}
        </dt>
        <dd>{s.label}</dd>
      </div>
    {/each}
  </dl>
  <p class="note">입력창에 글자를 쓰는 중에는 동작하지 않아요</p>
</Sheet>

<style>
  dl {
    margin: 0;
    padding: 0 20px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 44px;
    border-bottom: 1px solid var(--line);
  }
  dt {
    flex: none;
    width: 76px;
    display: flex;
    gap: 4px;
  }
  dd {
    margin: 0;
    font-size: 14px;
  }
  kbd {
    min-width: 26px;
    padding: 2px 7px;
    text-align: center;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    border-radius: 7px;
    background: var(--surface2);
    border: 1px solid var(--line);
    color: var(--t1);
  }
  .note {
    padding: 10px 20px 0;
    font-size: 12px;
    color: var(--t3);
  }
</style>
