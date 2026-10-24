<script lang="ts">
  import { parseHelpText } from '../../help/helpText';

  // 도움말 문구 한 줄: `단추 이름`은 단추 모양, **강조**는 굵게, 링크는 새 창.
  let { text }: { text: string } = $props();
  const parts = $derived(parseHelpText(text));
</script>

{#each parts as p, i (i)}{#if p.kind === 'key'}<span class="key">{p.text}</span>{:else if p.kind === 'strong'}<strong>{p.text}</strong>{:else if p.kind === 'link'}<a href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>{:else}{p.text}{/if}{/each}

<style>
  .key {
    padding: 0 5px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
    white-space: nowrap;
  }
  a {
    color: var(--accent);
    font-weight: 700;
  }
</style>
