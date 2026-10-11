<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { sessionsForDay, type DaySession, type TradingDay } from './lib/market/sessions';
  import { createApp } from './lib/state/app.svelte';
  import { createClock } from './lib/state/clock.svelte';
  import { createSafeStorage } from './lib/state/storage';
  import { kstDate } from './lib/time/kst';
  import Banner from './lib/ui/components/Banner.svelte';
  import SnackbarHost from './lib/ui/components/SnackbarHost.svelte';
  import { dismissSnackbar } from './lib/ui/components/snackbarStore.svelte';
  import Layout from './lib/ui/Layout.svelte';
  import Rail from './lib/ui/Rail.svelte';
  import StatusChip from './lib/ui/StatusChip.svelte';
  import Compare from './routes/Compare.svelte';
  import ProfilePicker from './routes/ProfilePicker.svelte';
  import Unlock from './routes/Unlock.svelte';

  const app = createApp({ storage: createSafeStorage(), now: () => Date.now() });
  const clock = createClock();
  onDestroy(() => {
    clock.destroy();
    app.destroy();
  });

  // ── 오늘 세션 (상태 칩) ───────────────────────────────────
  const warned = new Set<string>();
  /** 같은 경고는 한 번만. 오류 이름·코드만 남기고 메시지(요청 정보가 섞일 수 있음)는 남기지 않는다. */
  function warnOnce(what: string, e: unknown) {
    if (warned.has(what)) return;
    warned.add(what);
    const code = (e as { code?: unknown } | null)?.code;
    console.warn(`[gazua] ${what}`, typeof code === 'string' ? code : e instanceof Error ? e.name : typeof e);
  }

  const today = $derived(kstDate(clock.now));
  let calendarDay = $state<TradingDay | null>(null);
  $effect(() => {
    const date = today;
    const provider = app.provider;
    let alive = true;
    provider.getTradingDays(date, date).then(
      (days) => {
        if (alive) calendarDay = days.find((d) => d.date === date) ?? { date, isOpen: false };
      },
      (e) => {
        if (!alive) return;
        warnOnce('거래일 캘린더를 받지 못해 기본 시간표를 써요', e);
        calendarDay = null;
      },
    );
    return () => {
      alive = false;
    };
  });
  // 캘린더를 아직 못 받았거나 실패하면 설정 파일의 기본 시간표(장이 열린 날)로 보여 준다.
  const day = $derived<TradingDay>(calendarDay?.date === today ? calendarDay : { date: today, isOpen: true });
  const sessions = $derived.by((): DaySession[] => {
    try {
      return sessionsForDay(day);
    } catch (e) {
      warnOnce('오늘 날짜의 세션 시간표가 없어요', e);
      return [];
    }
  });

  const route = $derived(app.route);

  // 프로필을 바꾸면 이전 프로필의 스낵바(되돌리기 포함)를 닫는다.
  $effect(() => {
    void app.meta.activeProfileId;
    untrack(dismissSnackbar);
  });

  function startDemo() {
    app.updateSettings({ provider: 'demo', onboarded: true });
    app.navigate({ name: 'compare' });
  }
</script>

<div class="shell">
  {#each app.banners as b (b.id)}
    <Banner
      message={b.text}
      actionLabel={b.action?.label}
      onaction={b.action?.run}
      tone={b.id === 'demo' ? 'info' : 'warn'}
    />
  {/each}

  {#if route.name === 'profiles'}
    <ProfilePicker {app} />
  {:else if route.name === 'unlock'}
    <Unlock {app} />
  {:else if route.name === 'onboarding'}
    <section class="placeholder">
      <h1>가즈아</h1>
      <p>온보딩은 다음 작업에서 만들어요.</p>
      <button type="button" class="primary" onclick={startDemo}>데모로 둘러보기</button>
    </section>
  {:else if route.name === 'compare'}
    <Compare {app} now={clock.now} {sessions} isOpenToday={day.isOpen} {barEnd} />
  {:else}
    <Layout>
      {#snippet rail()}
        <Rail {app} />
      {/snippet}

      {#snippet bar()}
        <span class="title">설정</span>
        <span class="spacer"></span>
        {@render barEnd()}
      {/snippet}

      {#snippet main()}
        <section class="placeholder">
          <p>설정 화면은 다음 작업에서 만들어요.</p>
          <button type="button" class="link" onclick={() => app.navigate({ name: 'compare' })}>비교로 돌아가기</button>
        </section>
      {/snippet}
    </Layout>
  {/if}
</div>

{#snippet barEnd()}
  <StatusChip {sessions} isOpenToday={day.isOpen} now={clock.now} />
  <button type="button" class="icon-btn" aria-label="설정" onclick={() => app.navigate({ name: 'settings' })}>
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
      />
    </svg>
  </button>
{/snippet}

<SnackbarHost />

<style>
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    min-height: 100dvh;
  }
  @media (min-width: 1024px) {
    .shell {
      height: 100vh;
      height: 100dvh;
    }
  }
  .placeholder {
    padding: 32px var(--gutter);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    color: var(--t2);
  }
  .placeholder h1 {
    color: var(--t1);
    font-size: 22px;
    font-weight: 800;
  }
  .primary {
    min-height: var(--touch);
    padding: 0 16px;
    border-radius: 12px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 700;
  }
  .link {
    min-height: var(--touch);
    color: var(--accent);
    font-weight: 700;
  }
  .title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .spacer {
    flex: 1;
  }
  .icon-btn {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    color: var(--t2);
    flex: none;
  }
  .icon-btn:hover {
    background: var(--surface2);
  }
</style>
