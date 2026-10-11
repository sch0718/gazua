<script lang="ts">
  // 공급자 라디오 카드(스펙 7.4, 목업 ⑤·⑥). 설정과 온보딩이 같은 컴포넌트를 쓴다.
  // 문구: 설정은 목업 ⑤, 온보딩은 목업 ⑥ 그대로(⑤에 없는 데모 카드는 ⑥의 문구).
  type ProviderId = 'kis' | 'toss' | 'demo';
  type Line = { ok: boolean; text: string };
  type Card = { id: ProviderId; name: string; badge?: string; lines: Line[] };

  let {
    value,
    onchange,
    variant = 'settings',
  }: { value: ProviderId; onchange: (id: ProviderId) => void; variant?: 'settings' | 'onboarding' } = $props();

  const DEMO: Card = {
    id: 'demo',
    name: '데모 데이터',
    lines: [
      { ok: true, text: '키 없이 모든 화면 체험' },
      { ok: false, text: '가상 시세' },
    ],
  };

  const CARDS: Record<'settings' | 'onboarding', Card[]> = {
    settings: [
      {
        id: 'kis',
        name: '한국투자증권 (KIS)',
        lines: [
          { ok: true, text: 'KRX·NXT·통합 전환' },
          { ok: true, text: 'Cloudflare Worker 프록시(무료)' },
        ],
      },
      {
        id: 'toss',
        name: '토스증권',
        lines: [
          { ok: false, text: '통합 시세만 (KRX·NXT 구분 불가)' },
          { ok: false, text: '고정 IP 프록시 필요(집 PC·NAS)' },
        ],
      },
      DEMO,
    ],
    onboarding: [
      {
        id: 'kis',
        name: '한국투자증권 (KIS)',
        badge: '추천',
        lines: [
          { ok: true, text: 'KRX·NXT·통합 전환' },
          { ok: true, text: '무료 Cloudflare Worker 프록시로 5분 설정' },
          { ok: false, text: '한국투자증권 계좌·API 신청 필요' },
        ],
      },
      {
        id: 'toss',
        name: '토스증권',
        lines: [
          { ok: true, text: 'WTS에서 키 바로 발급' },
          { ok: false, text: '통합 시세만 (KRX·NXT 구분 불가)' },
          { ok: false, text: '집 PC·NAS에 고정 IP 프록시 필요' },
        ],
      },
      DEMO,
    ],
  };

  const uid = Math.random().toString(36).slice(2, 8);
  const cards = $derived(CARDS[variant]);
  let buttons = $state<HTMLButtonElement[]>([]);

  function onkeydown(e: KeyboardEvent, i: number) {
    const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + cards.length) % cards.length;
    onchange(cards[next].id);
    buttons[next]?.focus();
  }
</script>

<div class="cards" role="radiogroup" aria-label="데이터 공급자">
  {#each cards as c, i (c.id)}
    <button
      type="button"
      role="radio"
      class="pcard"
      class:on={c.id === value}
      aria-checked={c.id === value}
      aria-labelledby="{uid}-{c.id}-name"
      aria-describedby="{uid}-{c.id}-lines"
      tabindex={c.id === value || (!cards.some((x) => x.id === value) && i === 0) ? 0 : -1}
      bind:this={buttons[i]}
      onclick={() => c.id !== value && onchange(c.id)}
      onkeydown={(e) => onkeydown(e, i)}
    >
      <i class="radio" aria-hidden="true"></i>
      <span class="body">
        <b id="{uid}-{c.id}-name">{c.name}</b>
        {#if c.badge}<span class="badge">{c.badge}</span>{/if}
        <!-- 버튼 안에는 구조 요소(ul·li)를 둘 수 없어 span으로 줄을 만든다. -->
        <span class="lines" id="{uid}-{c.id}-lines">
          {#each c.lines as l (l.text)}
            <span class="line" class:y={l.ok} class:n={!l.ok}><span class="mark" aria-hidden="true">{l.ok ? '✓' : '–'}</span> {l.text}</span>
          {/each}
        </span>
      </span>
    </button>
  {/each}
</div>

<style>
  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pcard {
    display: flex;
    gap: 12px;
    padding: 14px;
    border: 1.5px solid var(--line);
    border-radius: var(--r-card);
    background: var(--surface);
    text-align: left;
    width: 100%;
    color: var(--t1);
  }
  .pcard.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .radio {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--t3);
    flex: none;
    margin-top: 2px;
  }
  .on .radio {
    border: 6px solid var(--accent);
  }
  b {
    font-size: 15px;
  }
  .badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 7px;
    border-radius: var(--r-chip);
    font-size: var(--fs-label);
    font-weight: 700;
    color: var(--accent);
    background: var(--accent-soft);
    vertical-align: 2px;
  }
  .body,
  .lines,
  .line {
    display: block;
  }
  .lines {
    font-size: 12.5px;
    color: var(--t2);
    margin-top: 4px;
  }
  .mark {
    font-weight: 700;
  }
  .y .mark {
    color: var(--ok);
  }
  .n .mark {
    color: var(--t3);
  }
</style>
