<script lang="ts">
  // 재생 막대(설계 §4.2): ▶/⏸ · 배속 · 날짜 · 타임라인(range).
  // 단축키는 range에만 건다: Space = 재생/일시정지, ←/→·Home/End는 range 기본 동작 → oninput → seek.
  // 버튼과 Segmented에는 따로 키 핸들러를 달지 않는다(이벤트가 겹치지 않게).
  import { Segmented } from '@sch0718/ui-svelte';
  import { REPLAY_SPEEDS, type Replay, type ReplaySpeed } from './replay.svelte';
  import { replayDate } from './simText';

  let { replay, dates }: { replay: Replay; dates: string[] } = $props();

  const day = $derived(replayDate(dates[replay.index] ?? dates.at(-1) ?? ''));
  const speedOptions = REPLAY_SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }));

  function onkeydown(e: KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      replay.toggle();
    }
  }
</script>

<div class="replay" role="group" aria-label="재생">
  <div class="top">
    <button type="button" class="play" aria-label={replay.playing ? '일시정지' : '재생'} onclick={() => replay.toggle()}>
      <span aria-hidden="true">{replay.playing ? '⏸' : '▶'}</span>
    </button>
    <p class="when num">{day} · {replay.index + 1}/{replay.length}거래일</p>
    <div class="speed">
      <Segmented label="배속" value={String(replay.speed)} options={speedOptions} onchange={(v) => replay.setSpeed(Number(v) as ReplaySpeed)} />
    </div>
  </div>
  <input
    class="range"
    type="range"
    min="0"
    max={replay.length - 1}
    step="1"
    value={replay.index}
    aria-label="거래일"
    aria-valuetext={day}
    oninput={(e) => replay.seek(Number(e.currentTarget.value))}
    {onkeydown}
  />
  <p class="note">일봉 기준이라 하루 단위로 움직여요</p>
  <!-- 재생 중에는 매일 알리지 않고, 멈췄을 때 날짜만 알린다 -->
  <p class="sr-only" aria-live="polite">{replay.playing ? '' : day}</p>
</div>

<style>
  .replay {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .top {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .play {
    min-width: var(--touch);
    min-height: var(--touch);
    border-radius: 12px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--fs-title);
  }
  .when {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .speed {
    margin-left: auto;
  }
  /* 좁은 화면(< 480px): 배속은 재생 버튼·날짜 아래 별도 줄 */
  @media (max-width: 479px) {
    .speed {
      flex-basis: 100%;
      margin-left: 0;
    }
  }
  .range {
    width: 100%;
    min-height: var(--touch);
    margin: 0;
    accent-color: var(--accent);
  }
  .note {
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--t3);
  }
</style>
