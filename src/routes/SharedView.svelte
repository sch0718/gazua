<!--
  로그인·프로필 없이 공유 내용을 읽기 전용으로 본다.
  받은 스냅샷은 저장소·캐시에 남기지 않는다. 「내 앱에 가져오기」를 누를 때만 탭 저장소(sessionStorage)에 대기 값을 둔다.
-->
<script lang="ts">
  import { Badge } from '@sch0718/ui-svelte';
  import type { ApiResult, SharedRead } from '../lib/sync/api';
  import type { UniverseItem } from '../lib/data/universe';
  import { kindLabel } from '../lib/share/kinds';
  import { isIos, isKakaoInApp, openExternalHref } from '../lib/share/inApp';
  import { stashImport } from '../lib/share/pendingImport';
  import { snapshotLines, symbolNames, type SymbolNames } from '../lib/share/shareText';
  import { checkShareSnapshot, type ShareSnapshot } from '../lib/share/snapshot';
  import SharedSimResult from '../lib/share/view/SharedSimResult.svelte';
  import SharedValidation from '../lib/share/view/SharedValidation.svelte';
  import { sharedUniverse } from '../sheets/universeSource';
  import { kstDate } from '../lib/time/kst';
  import { kstHHMM } from '../lib/ui/compare/compareText';
  import { dotDate } from '../lib/ui/simulate/simText';

  let {
    capability,
    read,
    onexit,
    universe = sharedUniverse,
    onimport = (s: ShareSnapshot) => void stashImport(s, now()),
    colorConvention = 'kr',
    theme,
    ua = globalThis.navigator?.userAgent ?? '',
    now = Date.now,
  }: {
    capability: string | undefined;
    /** 동기화 설정이 없는 빌드면 null */
    read: ((cap: string) => Promise<ApiResult<SharedRead>>) | null;
    onexit: () => void;
    universe?: () => Promise<UniverseItem[]>;
    /** 「내 앱에 가져오기」를 누르면 stashImport로 대기 값을 두고 onexit으로 앱에 들어가 확인 창에서 저장한다(설계 4.8). */
    onimport?: (s: ShareSnapshot) => void;
    /** 보는 사람의 색 관례·테마(app.settings) */
    colorConvention?: 'kr' | 'global';
    theme?: string;
    ua?: string;
    now?: () => number;
  } = $props();

  type Fail = 'gone' | 'missing' | 'offline' | 'unavailable' | 'error' | 'unsupported' | 'unreadable';
  type View = { state: 'loading' } | { state: 'ok'; data: SharedRead; snapshot: ShareSnapshot } | { state: Fail };
  let view = $state<View>({ state: 'loading' });

  // 종목 이름은 앱의 종목 목록에서 찾는다. 받지 못하면 코드만 보인다.
  let names = $state<SymbolNames | undefined>(undefined);
  $effect(() => {
    let alive = true;
    universe().then(
      (items) => {
        if (alive) names = symbolNames(items);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  });

  $effect(() => {
    const cap = capability;
    if (!read) {
      view = { state: 'unavailable' };
      return;
    }
    if (!cap) {
      view = { state: 'missing' };
      return;
    }
    let alive = true;
    view = { state: 'loading' };
    read(cap).then((r) => {
      if (!alive) return;
      if (r.ok) {
        const c = checkShareSnapshot(r.data.snapshot, r.data.kind, now(), 'read');
        view = c.ok ? { state: 'ok', data: r.data, snapshot: c.snapshot } : { state: c.code === 'unsupported' ? 'unsupported' : 'unreadable' };
      } else view = { state: r.kind === 'gone' ? 'gone' : r.kind === 'not-found' ? 'missing' : r.kind === 'offline' ? 'offline' : 'error' };
    });
    return () => {
      alive = false;
    };
  });

  const MESSAGE: Record<Fail, string> = {
    gone: '만료됐거나 철회된 공유예요.',
    missing: '링크가 맞지 않아요. 받은 주소를 다시 확인해 주세요.',
    offline: '서버에 연결할 수 없어요. 연결을 확인하고 다시 열어 주세요.',
    unavailable: '이 앱에는 공유 기능이 설정되지 않았어요.',
    error: '공유를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.',
    unsupported: '이 공유는 새 버전 앱에서 볼 수 있어요. 앱을 새로 고쳐 주세요.',
    unreadable: '이 공유를 읽을 수 없어요. 보낸 사람에게 다시 만들어 달라고 해 주세요.',
  };
  /** 규칙 원문: 결과 종류는 규칙 부분(strategy 또는 criteria·baskets)만. result를 거대한 JSON으로 그리지 않는다(설계 4.7) */
  const rulesOf = (s: ShareSnapshot): Record<string, unknown> | null => {
    switch (s.kind) {
      case 'group':
      case 'compare':
        return null;
      case 'strategy':
      case 'simResult':
        return { strategy: s.strategy };
      case 'criteria':
      case 'validation':
        return { criteria: s.criteria, baskets: s.baskets };
    }
  };
  const isResult = (s: ShareSnapshot) => s.kind === 'simResult' || s.kind === 'validation';
  const runLine = (s: ShareSnapshot) =>
    s.kind === 'simResult' || s.kind === 'validation'
      ? `${dotDate(s.run.from)} ~ ${dotDate(s.run.to)} · ${s.run.source} · ${dotDate(kstDate(s.run.fetchedAt))} ${kstHHMM(s.run.fetchedAt)} 받음`
      : null;
  const inApp = $derived(isKakaoInApp(ua));
  function importIt(s: ShareSnapshot) {
    try {
      onimport(s);
    } finally {
      onexit();
    }
  }
  const fmtDate = (t: number) => new Date(t).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
</script>

<main class="shared">
  <header>
    <span class="badge">읽기 전용 공유</span>
    <button type="button" class="exit" onclick={onexit}>가즈아 열기</button>
  </header>
  {#if inApp}
    <div class="inapp" role="note">
      <p>카카오톡 안에서 열었어요. 여기서 가져오면 이 카카오톡 브라우저에만 저장돼요. 평소 쓰는 브라우저에 저장하려면 기본 브라우저로 열어 주세요.</p>
      {#if isIos(ua)}<p>홈 화면에 추가한 가즈아는 Safari와 저장소가 따로라, 홈 화면 앱에서 이 링크를 다시 열어야 거기에 저장돼요.</p>{/if}
      <button type="button" onclick={() => (location.href = openExternalHref(location.href))}>기본 브라우저로 열기</button>
    </div>
  {/if}
  {#if view.state === 'loading'}
    <p role="status">불러오는 중…</p>
  {:else if view.state === 'ok'}
    {@const s = view.snapshot}
    {@const rules = rulesOf(s)}
    <h1>{view.data.title}</h1>
    <p class="meta">{kindLabel(s.kind)} · {fmtDate(view.data.expiresAt)}까지 볼 수 있어요</p>
    {#if s.kind === 'simResult' || s.kind === 'validation'}
      {#if s.kind === 'validation'}<p class="run">{runLine(s)}</p>{/if}
      {#if (s.kind === 'validation' && s.run.demo) || s.capitalHidden}
        <p class="badges">
          {#if s.kind === 'validation' && s.run.demo}<Badge>데모 데이터</Badge>{/if}
          {#if s.capitalHidden}<Badge>초기 자금 비공개</Badge>{/if}
        </p>
      {/if}
      <h2 class="sr-only">{kindLabel(s.kind)}</h2>
    {/if}
    {#if s.kind === 'simResult'}
      <SharedSimResult snapshot={s} {names} {colorConvention} {theme} />
    {:else if s.kind === 'validation'}
      <SharedValidation snapshot={s} {names} {colorConvention} {theme} />
    {:else}
      <ul class="lines">
        {#each snapshotLines(s, names) as line, i (i)}<li>{line}</li>{/each}
      </ul>
      {#if s.kind === 'compare'}<p class="note">가져오면 내 연결이나 데모로 같은 화면을 볼 수 있어요</p>{/if}
    {/if}
    {#if rules}
      <!-- 요약은 일부만 보여 준다. 받은 규칙 전부를 그대로 읽을 수 있게 한다(결과 부분은 넣지 않는다). -->
      <details class="rules">
        <summary>규칙 전체 보기</summary>
        <pre>{JSON.stringify(rules, null, 2)}</pre>
      </details>
    {/if}
    <div class="import">
      <button type="button" class="primary" onclick={() => importIt(s)}>내 앱에 가져오기</button>
      <p class="note">이 기기의 프로필에 저장해요. 로그인이나 키가 없어도 돼요.{isResult(s) ? ' 결과는 저장하지 않고 규칙만 가져와요' : ''}</p>
    </div>
    <p class="note">공유한 사람의 다른 데이터·계좌·키는 들어 있지 않아요. 이 화면의 내용은 이 기기에 저장하지 않아요.</p>
  {:else}
    <p class="msg" role="alert">{MESSAGE[view.state]}</p>
  {/if}
</main>

<style>
  .shared {
    max-width: 720px;
    margin: 0 auto;
    padding: 16px var(--gutter) 48px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .badge {
    font-size: var(--fs-label);
    font-weight: 700;
    color: var(--t2);
    background: var(--surface2);
    border-radius: 999px;
    padding: 4px 10px;
  }
  .exit {
    min-height: var(--touch);
    padding: 0 14px;
    border-radius: 12px;
    background: var(--surface2);
    font-weight: 700;
  }
  h1 {
    font-size: 22px;
    font-weight: 800;
  }
  .meta,
  .note {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .lines {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 12px 16px 12px 32px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: var(--fs-body);
    word-break: break-all;
  }
  .msg {
    font-size: var(--fs-body);
  }
  .rules summary {
    min-height: var(--touch);
    display: flex;
    align-items: center;
    font-weight: 700;
    cursor: pointer;
  }
  .rules pre {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 12px 16px;
    font-size: var(--fs-sub);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .inapp {
    background: var(--surface2);
    border-radius: var(--r-card);
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: var(--fs-sub);
  }
  .inapp button,
  .primary {
    min-height: var(--touch);
    padding: 0 14px;
    border-radius: 12px;
    font-weight: 700;
  }
  .inapp button {
    background: var(--surface);
    align-self: flex-start;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
    width: 100%;
  }
  .run {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .badges {
    display: flex;
    gap: 6px;
  }
  .import {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
