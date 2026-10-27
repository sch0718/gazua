<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { sessionsForDay, type DaySession, type TradingDay } from './lib/market/sessions';
  import { createApp } from './lib/state/app.svelte';
  import { createClock } from './lib/state/clock.svelte';
  import { createSafeStorage } from './lib/state/storage';
  import { kstDate } from './lib/time/kst';
  import { Banner } from '@sch0718/ui-svelte';
  import { SnackbarHost } from '@sch0718/ui-svelte';
  import { dismissSnackbar } from '@sch0718/ui-svelte';
  import StatusChip from './lib/ui/StatusChip.svelte';
  import { helpIdForRoute } from './lib/help/routing';
  import HelpButton from './lib/ui/help/HelpButton.svelte';
  import HelpIntro from './lib/ui/help/HelpIntro.svelte';
  import Compare from './routes/Compare.svelte';
  import Help from './routes/Help.svelte';
  import Onboarding from './routes/Onboarding.svelte';
  import Performance from './routes/Performance.svelte';
  import ProfilePicker from './routes/ProfilePicker.svelte';
  import Simulate from './routes/Simulate.svelte';
  import Settings from './routes/Settings.svelte';
  import Unlock from './routes/Unlock.svelte';
  import SharedView from './routes/SharedView.svelte';
  import ShareHost from './lib/share/ShareHost.svelte';
  import { setShareController } from './lib/share/shareStore.svelte';
  import { createSyncApi } from './lib/sync/api';
  import { readSyncConfig } from './lib/sync/config';
  import { createSyncController } from './lib/sync/controller.svelte';

  const storage = createSafeStorage();
  // 동기화 설정(VITE_*)이 없는 빌드면 configured=false로 아무것도 하지 않는다.
  const syncConfig = readSyncConfig();
  const sync = createSyncController({ config: syncConfig, storage });
  const app = createApp({ storage, now: () => Date.now(), onSyncableChange: (e) => sync.onSyncableChange(e) });
  setShareController(sync);
  // 공유 읽기는 로그인 없이 capability 헤더로만 읽는다.
  const publicApi = syncConfig ? createSyncApi(syncConfig.apiUrl, { idToken: async () => null, sessionId: async () => null }) : null;
  const clock = createClock();
  onMount(() => {
    void sync.attach(app);
  });
  onDestroy(() => {
    clock.destroy();
    sync.destroy();
    setShareController(null);
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
</script>

<div class="shell">
  {#each route.name === 'shared' ? [] : app.banners as b (b.id)}
    <Banner
      message={b.text}
      actionLabel={b.action?.label}
      onaction={b.action?.run}
      tone={b.id === 'demo' ? 'info' : 'warn'}
    />
  {/each}

  {#if route.name === 'shared'}
    <SharedView
      capability={route.capability}
      read={publicApi ? (cap) => publicApi.readShare(cap) : null}
      onexit={() => app.navigate({ name: 'compare' })}
    />
  {:else if route.name === 'profiles'}
    <ProfilePicker {app} />
  {:else if route.name === 'unlock'}
    <Unlock {app} />
  {:else if route.name === 'onboarding'}
    {#key app.meta.activeProfileId}
      <Onboarding {app} />
    {/key}
  {:else if route.name === 'compare'}
    <Compare {app} now={clock.now} {sessions} isOpenToday={day.isOpen} {barEnd} />
  {:else if route.name === 'simulate'}
    <Simulate {app} {barEnd} />
  {:else if route.name === 'performance'}
    <Performance {app} {barEnd} />
  {:else if route.name === 'help'}
    <Help {app} {barEnd} />
  {:else}
    <Settings {app} {barEnd} {sync} />
  {/if}
</div>

<!-- compact(시뮬레이션·내 성과·설정의 폰 폭)이면 상태 칩을 뺀다. 비교 화면은 인자 없이 부른다. -->
{#snippet barEnd(compact: boolean = false)}
  {#if !compact}
    <StatusChip {sessions} isOpenToday={day.isOpen} now={clock.now} />
  {/if}
  {@const helpId = helpIdForRoute(route)}
  {#if helpId}<HelpButton {app} page={helpId} narrowHide={route.name === 'compare'} />{/if}
  <button
    type="button"
    class="icon-btn"
    class:on={route.name === 'performance'}
    aria-label="내 성과"
    aria-current={route.name === 'performance' ? 'page' : undefined}
    onclick={() => app.navigate({ name: 'performance' })}
  >
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M7 15l3-3 2 2 5-5" />
    </svg>
  </button>
  <button
    type="button"
    class="icon-btn"
    class:on={route.name === 'simulate'}
    aria-label="시뮬레이션"
    aria-current={route.name === 'simulate' ? 'page' : undefined}
    onclick={() => app.navigate({ name: 'simulate' })}
  >
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-6" />
    </svg>
  </button>
  <button type="button" class="icon-btn" aria-label="설정" onclick={() => app.navigate({ name: 'settings' })}>
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
      />
    </svg>
  </button>
{/snippet}

{#if route.name !== 'shared'}<HelpIntro {app} />{/if}
<ShareHost />
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
  .icon-btn {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    color: var(--t2);
    flex: none;
  }
  .icon-btn:hover,
  .icon-btn.on {
    background: var(--surface2);
  }
  .icon-btn.on {
    color: var(--t1);
  }
</style>
