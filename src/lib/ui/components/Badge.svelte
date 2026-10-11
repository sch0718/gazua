<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    tone = 'neutral',
    children,
  }: { tone?: 'neutral' | 'nxt' | 'warn'; children: Snippet } = $props();
</script>

<span class="badge {tone}">{@render children()}</span>

<style>
  .badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 800;
    padding: 1px 5px;
    border-radius: 5px;
    background: var(--surface2);
    color: var(--t2);
    margin-left: 4px;
    vertical-align: 1px;
  }
  .nxt {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .warn {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 15%, transparent);
  }
</style>
