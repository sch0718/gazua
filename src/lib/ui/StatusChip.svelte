<script lang="ts">
  import type { DaySession } from '../market/sessions';
  import { sessionLabelAt } from '../market/tradable';
  import { kstMinuteOfDay } from '../time/kst';
  import Sheet from './components/Sheet.svelte';

  let { sessions, isOpenToday, now }: { sessions: DaySession[]; isOpenToday: boolean; now: number } = $props();

  let open = $state(false);

  const pad = (n: number) => String(n).padStart(2, '0');
  /** KST `HH:MM`. 초가 0이 아니면 `HH:MM:SS`(NXT 정규 09:00:30). */
  function kstTime(ms: number, withSeconds = false): string {
    const m = kstMinuteOfDay(ms);
    const s = Math.floor(ms / 1000) % 60;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}${withSeconds && s !== 0 ? `:${pad(s)}` : ''}`;
  }

  /** 세션 이름. sessionLabelAt의 라벨 표를 그대로 쓴다. */
  const sessionName = (s: DaySession) => sessionLabelAt([s], s.start)?.label ?? `${s.venue} ${s.label}`;

  const current = $derived(isOpenToday ? sessionLabelAt(sessions, now) : null);

  /** label은 장중 세션 이름(아주 좁은 화면에서는 숨기고 시각만 보인다) */
  const status = $derived.by((): { live: boolean; text: string; label?: string; time?: string } => {
    if (!isOpenToday) return { live: false, text: '휴장' };
    if (current) return { live: true, text: `${current.label} · ${kstTime(now)}`, label: current.label, time: kstTime(now) };
    const firstStart = sessions.length > 0 ? Math.min(...sessions.map((s) => s.start)) : -Infinity;
    return { live: false, text: now < firstStart ? '◌ 장 시작 전' : '◌ 장 마감' };
  });

  const rows = $derived(
    [...sessions]
      .sort((a, b) => a.start - b.start || a.venue.localeCompare(b.venue))
      .map((s) => {
        const name = sessionName(s);
        return {
          key: `${s.venue}:${s.label}`,
          name: s.excludes?.length ? `${name} (${s.excludes.join('·')} 제외)` : name,
          range: `${kstTime(s.start, true)}–${kstTime(s.end, true)}`,
          now: current !== null && s.start <= now && now < s.end && name === current.label,
        };
      }),
  );
</script>

<button
  type="button"
  class="chip-status num"
  aria-haspopup="dialog"
  aria-label="{status.text.replace(/^◌ /, '')} · 오늘 세션 시간표 보기"
  onclick={() => (open = true)}
>
  {#if status.live}<span class="dot" aria-hidden="true">●</span>{/if}{#if status.label !== undefined}<span class="label">{status.label} · </span>{status.time}{:else}{status.text}{/if}
</button>

<Sheet {open} title="오늘 세션 (KST)" onclose={() => (open = false)}>
  <p class="sub">자동 모드는 KRX 우선이에요. KRX가 접속매매 중이 아닐 때만 NXT를 써요.</p>
  {#if !isOpenToday || rows.length === 0}
    <p class="sub">오늘은 휴장이에요</p>
  {:else}
    <ul>
      {#each rows as r (r.key)}
        <li class:now={r.now} aria-current={r.now ? 'true' : undefined}>
          <span>{r.name}{r.now ? ' · 지금' : ''}</span> <b class="num">{r.range}</b>
        </li>
      {/each}
    </ul>
  {/if}
</Sheet>

<style>
  .chip-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 700;
    padding: 7px 11px;
    border-radius: 999px;
    background: var(--surface2);
    color: var(--t1);
    white-space: nowrap;
    min-height: 34px;
    position: relative;
  }
  /* 보이는 높이는 34px, 눌리는 영역은 44px. */
  .chip-status::before {
    content: '';
    position: absolute;
    inset: -5px -2px;
  }
  /* 폭 360px 미만(320px 폰)에서는 세션 이름을 숨겨 앱 바의 그룹 탭 자리를 남긴다. 이름은 aria-label에 그대로 있다 */
  @media (max-width: 359px) {
    .label {
      display: none;
    }
    .chip-status {
      padding: 7px 9px;
    }
  }
  .dot {
    color: var(--ok);
    font-size: 9px;
    margin-right: -2px;
  }
  .sub {
    font-size: 13px;
    color: var(--t2);
    padding: 0 20px 10px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 20px;
    font-size: 14px;
  }
  li span {
    color: var(--t2);
  }
  li.now,
  li.now span {
    color: var(--accent);
    font-weight: 800;
  }
</style>
