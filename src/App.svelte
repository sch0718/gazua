<script lang="ts">
  import { onDestroy } from 'svelte';
  import { sessionsForDay, type DaySession, type TradingDay } from './lib/market/sessions';
  import { createApp } from './lib/state/app.svelte';
  import { createClock } from './lib/state/clock.svelte';
  import { createSafeStorage } from './lib/state/storage';
  import { kstDate } from './lib/time/kst';
  import Banner from './lib/ui/components/Banner.svelte';
  import SnackbarHost from './lib/ui/components/SnackbarHost.svelte';
  import Layout from './lib/ui/Layout.svelte';
  import StatusChip from './lib/ui/StatusChip.svelte';
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
  const group = $derived(
    route.name === 'compare' ? app.watchlists.groups.find((g) => g.id === route.groupId) : undefined,
  );
  const profile = $derived(app.meta.profiles.find((p) => p.id === app.meta.activeProfileId));

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
  {:else}
    <Layout side={route.name === 'compare' ? side : undefined}>
      {#snippet rail()}
        <div class="brand"><i aria-hidden="true"></i>가즈아</div>
        {#if app.meta.profiles.length > 1}
          <button type="button" class="ritem" onclick={() => app.navigate({ name: 'profiles' })}>
            {profile?.name}<em>▾</em>
          </button>
        {:else}
          <div class="ritem static">{profile?.name}</div>
        {/if}
        <div class="rlabel">관심 그룹</div>
        {#each app.watchlists.groups as g (g.id)}
          <button
            type="button"
            class="ritem"
            class:on={route.name === 'compare' && route.groupId === g.id}
            aria-current={route.name === 'compare' && route.groupId === g.id ? 'page' : undefined}
            onclick={() => app.navigate({ name: 'compare', groupId: g.id })}
          >
            {g.name}<em>{g.items.length}</em>
          </button>
        {/each}
        <button
          type="button"
          class="ritem settings-item"
          class:on={route.name === 'settings'}
          onclick={() => app.navigate({ name: 'settings' })}
        >
          설정
        </button>
      {/snippet}

      {#snippet bar()}
        <span class="title">{route.name === 'settings' ? '설정' : (group?.name ?? '가즈아')}</span>
        <span class="spacer"></span>
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

      {#snippet main()}
        {#if route.name === 'settings'}
          <section class="placeholder">
            <p>설정 화면은 다음 작업에서 만들어요.</p>
            <button type="button" class="link" onclick={() => app.navigate({ name: 'compare' })}>비교로 돌아가기</button>
          </section>
        {:else}
          <section class="placeholder">
            <p>비교 화면은 다음 작업에서 만들어요.</p>
          </section>
        {/if}
      {/snippet}
    </Layout>
  {/if}
</div>

{#snippet side()}
  <p class="side-note">리더보드는 다음 작업에서 만들어요.</p>
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
  .side-note {
    padding: 12px 8px;
    font-size: var(--fs-sub);
    color: var(--t3);
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
  .brand {
    font-weight: 800;
    font-size: 19px;
    padding: 4px 10px 14px;
    letter-spacing: -0.02em;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .brand i {
    width: 24px;
    height: 24px;
    border-radius: 8px;
    background: linear-gradient(135deg, var(--s1), var(--s3));
    display: block;
  }
  .ritem {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    min-height: var(--touch);
    border-radius: 10px;
    font-size: 14px;
    color: var(--t2);
    text-align: left;
    width: 100%;
  }
  button.ritem:hover {
    background: var(--surface2);
  }
  .ritem.on {
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
  }
  .ritem em {
    margin-left: auto;
    font-style: normal;
    font-size: 12px;
    color: var(--t3);
  }
  .rlabel {
    font-size: var(--fs-label);
    font-weight: 700;
    color: var(--t3);
    padding: 14px 10px 4px;
    letter-spacing: 0.04em;
  }
  .settings-item {
    margin-top: auto;
  }
</style>
