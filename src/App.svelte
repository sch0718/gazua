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
  import TabBar from './lib/ui/TabBar.svelte';
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
  import ImportHost from './lib/share/ImportHost.svelte';
  import { setShareController } from './lib/share/shareStore.svelte';
  import { createSyncApi } from './lib/sync/api';
  import { readSyncConfig } from './lib/sync/config';
  import { createSyncController } from './lib/sync/controller.svelte';
  import { restoreReferrerPolicy, type SocialReturn } from './lib/sync/social';

  let {
    socialReturn = null,
    loadSocialCallback = () => import('./lib/ui/settings/SocialCallback.svelte'),
  }: {
    socialReturn?: SocialReturn | null;
    loadSocialCallback?: () => Promise<typeof import('./lib/ui/settings/SocialCallback.svelte')>;
  } = $props();
  let pendingSocial = $state(untrack(() => socialReturn));
  // 대기 중인 로그인이 바뀔 때만 화면 청크를 요청해요.
  const socialCallback = $derived(pendingSocial ? untrack(() => loadSocialCallback()) : null);
  function socialDone(hash: string) {
    restoreReferrerPolicy();
    history.replaceState(history.state, '', import.meta.env.BASE_URL + hash);
    pendingSocial = null;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  const storage = createSafeStorage();
  // 동기화 설정(VITE_*)이 없는 빌드면 configured=false로 아무것도 하지 않는다.
  const syncConfig = readSyncConfig();
  const sync = createSyncController({ config: syncConfig, storage });
  const app = createApp({
    storage,
    now: () => Date.now(),
    onSyncableChange: (e) => sync.onSyncableChange(e),
    onSecretsChange: (e) => sync.onSecretsChange(e),
    onLock: () => sync.onLock(),
  });
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
  // 아래 탭 막대는 앱의 주요 화면에서만 보인다(공유 보기·프로필 고르기·잠금 풀기·처음 설정 제외).
  const tabbed = $derived(!pendingSocial && ['compare', 'performance', 'simulate', 'settings', 'help'].includes(route.name));

  // 프로필을 바꾸면 이전 프로필의 스낵바(되돌리기 포함)를 닫는다.
  $effect(() => {
    void app.meta.activeProfileId;
    untrack(dismissSnackbar);
  });
</script>

<div class="shell" class:tabbed>
  {#each pendingSocial || route.name === 'shared' ? [] : app.banners as b (b.id)}
    <Banner
      message={b.text}
      actionLabel={b.action?.label}
      onaction={b.action?.run}
      tone={b.id === 'demo' ? 'info' : 'warn'}
    />
  {/each}

  {#if pendingSocial}
    {@const ret = pendingSocial}
    {#await socialCallback!}
      <p role="status">로그인 결과를 확인하는 중…</p>
    {:then module}
      <module.default {sync} {ret} ondone={socialDone} />
    {:catch}
      <main class="social-fallback">
        <div class="social-card">
          <div role="alert">
            <h1>로그인 화면을 불러오지 못했어요</h1>
            <p>인터넷 연결을 확인하고 돌아가서 다시 시도해 주세요.</p>
          </div>
          <button type="button" onclick={() => socialDone(ret.returnHash)}>돌아가기</button>
        </div>
      </main>
    {/await}
  {:else if route.name === 'shared'}
    <SharedView
      capability={route.capability}
      read={publicApi ? (cap) => publicApi.readShare(cap) : null}
      onexit={() => app.leaveShared()}
      colorConvention={app.settings.colorConvention}
      theme={`${app.settings.theme}:${app.settings.palette}`}
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
  <!-- 고정 위치라 자리는 상관없지만, --tabbar-h를 물려받도록 .shell 안에 둔다 -->
  {#if tabbed}<TabBar {app} />{/if}
</div>

<!-- compact(시뮬레이션·내 성과·설정의 폰 폭)이면 상태 칩을 뺀다. 비교 화면은 인자 없이 부른다.
     화면 이동(내 성과·시뮬레이션·설정)은 폰·태블릿의 아래 탭 막대와 PC 레일이 맡는다. -->
{#snippet barEnd(compact: boolean = false)}
  {#if !compact}
    <StatusChip {sessions} isOpenToday={day.isOpen} now={clock.now} />
  {/if}
  {@const helpId = helpIdForRoute(route)}
  {#if helpId}<HelpButton {app} page={helpId} />{/if}
{/snippet}

{#if !pendingSocial && route.name !== 'shared'}<HelpIntro {app} />{/if}
<ShareHost />
<ImportHost {app} />
<SnackbarHost />

<style>
  .social-fallback {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 24px 16px;
  }
  .social-card {
    width: 100%;
    max-width: 440px;
    box-sizing: border-box;
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 24px 20px;
  }
  .social-card h1 {
    font-size: var(--fs-body);
    font-weight: 700;
  }
  .social-card p {
    font-size: var(--fs-sub);
    color: var(--t2);
    line-height: 1.6;
    margin-top: 6px;
  }
  .social-card button {
    min-height: var(--touch);
    margin-top: 16px;
    padding: 0 14px;
    border-radius: 12px;
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
  }
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
  /* 폰·태블릿: 고정된 아래 탭 막대만큼 아래를 비운다. 화면 안의 하단 고정 막대(실행 단추)는 --tabbar-h 위에 붙는다. */
  .shell.tabbed {
    --tabbar-h: calc(58px + env(safe-area-inset-bottom, 0px));
    --below-safe: 0px;
    padding-bottom: var(--tabbar-h);
  }
  @media (min-width: 1024px) {
    .shell.tabbed {
      --tabbar-h: 0px;
      --below-safe: env(safe-area-inset-bottom, 0px);
      padding-bottom: 0;
    }
  }
</style>
