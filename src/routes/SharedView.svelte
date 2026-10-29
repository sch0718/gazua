<script lang="ts">
  // 공유 읽기 화면(#/s/<capability>): 로그인·프로필 없이 읽기 전용으로 본다. 받은 스냅샷은 저장소·캐시에 남기지 않는다.
  import type { ApiResult, SharedRead } from '../lib/sync/api';
  import type { UniverseItem } from '../lib/data/universe';
  import { snapshotLines, symbolNames, type SymbolNames } from '../lib/share/shareText';
  import { sharedUniverse } from '../sheets/universeSource';

  let {
    capability,
    read,
    onexit,
    universe = sharedUniverse,
  }: {
    capability: string | undefined;
    /** 동기화 설정이 없는 빌드면 null */
    read: ((cap: string) => Promise<ApiResult<SharedRead>>) | null;
    onexit: () => void;
    universe?: () => Promise<UniverseItem[]>;
  } = $props();

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

  type View = { state: 'loading' } | { state: 'ok'; data: SharedRead } | { state: 'gone' | 'missing' | 'offline' | 'unavailable' | 'error' };
  let view = $state<View>({ state: 'loading' });

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
      if (r.ok) view = { state: 'ok', data: r.data };
      else view = { state: r.kind === 'gone' ? 'gone' : r.kind === 'not-found' ? 'missing' : r.kind === 'offline' ? 'offline' : 'error' };
    });
    return () => {
      alive = false;
    };
  });

  const KIND = { group: '그룹', strategy: '전략', criteria: '선정 기준', compare: '비교 화면', simResult: '시뮬레이션 결과', validation: '선정 기준 검증' } as const;
  const MESSAGE = {
    gone: '만료됐거나 철회된 공유예요.',
    missing: '링크가 맞지 않아요. 받은 주소를 다시 확인해 주세요.',
    offline: '서버에 연결할 수 없어요. 연결을 확인하고 다시 열어 주세요.',
    unavailable: '이 앱에는 공유 기능이 설정되지 않았어요.',
    error: '공유를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.',
  } as const;
  /** 규칙 원문: 스냅샷에서 종류·버전·제목을 뺀 나머지(전략이나 선정 기준, 참조한 묶음). */
  const rulesOf = (snap: SharedRead['snapshot']) => {
    const { kind: _kind, v: _v, title: _title, ...rest } = snap as unknown as Record<string, unknown>;
    return rest;
  };
  const fmtDate = (t: number) => new Date(t).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
</script>

<main class="shared">
  <header>
    <span class="badge">읽기 전용 공유</span>
    <button type="button" class="exit" onclick={onexit}>가즈아 열기</button>
  </header>
  {#if view.state === 'loading'}
    <p role="status">불러오는 중…</p>
  {:else if view.state === 'ok'}
    <h1>{view.data.title}</h1>
    <p class="meta">{KIND[view.data.kind]} · {fmtDate(view.data.expiresAt)}까지 볼 수 있어요</p>
    <ul class="lines">
      {#each snapshotLines(view.data.snapshot, names) as line, i (i)}<li>{line}</li>{/each}
    </ul>
    {#if view.data.snapshot.kind !== 'group'}
      <!-- 요약 줄은 일부만 보여 준다. 받은 규칙 전부(조건·정렬·매수 신호·묶음 종목 등)를 그대로 읽을 수 있게 한다. -->
      <details class="rules">
        <summary>규칙 전체 보기</summary>
        <pre>{JSON.stringify(rulesOf(view.data.snapshot), null, 2)}</pre>
      </details>
    {/if}
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
</style>
