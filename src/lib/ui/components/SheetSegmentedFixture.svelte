<!-- 테스트 전용: 마지막 컨트롤이 Segmented(roving tabindex)인 Sheet. -->
<script lang="ts">
  import Segmented from './Segmented.svelte';
  import Sheet from './Sheet.svelte';

  let { onclose = () => {} }: { onclose?: () => void } = $props();
  let value = $state('b');
  const options = [
    { value: 'a', label: '가' },
    { value: 'b', label: '나' },
    { value: 'c', label: '다' },
  ];
</script>

<Sheet open={true} title="거래소" {onclose}>
  {#snippet children()}
    <Segmented {options} {value} onchange={(v) => (value = v)} label="거래소 모드" />
  {/snippet}
</Sheet>
