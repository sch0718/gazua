<script lang="ts">
  // 매수 조건(스펙 §10.2): 묶음 안 조건은 모두, 묶음끼리는 하나만 맞으면 산다. 휴대폰도 한 열.
  import type { Strategy } from '../../../sim/types';
  import CondGroupsEditor from './CondGroupsEditor.svelte';

  let { s, update }: { s: Strategy; update: (fn: (s: Strategy) => void) => void } = $props();
</script>

<p class="hint">묶음 안 조건은 모두, 묶음끼리는 하나만 맞으면 사요.</p>
<p class="hint">팔고 난 다음 날에도 조건이 맞으면 다시 살 수 있어요. 패턴·교차·돌파는 새로 일어나야 맞아요.</p>
<CondGroupsEditor groups={s.rules.buy} prefix="매수 묶음" allowPattern update={(fn) => update((x) => fn(x.rules.buy))} />
