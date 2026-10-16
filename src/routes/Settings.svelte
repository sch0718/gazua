<script lang="ts">
  // 설정 화면(스펙 7.4, 목업 ⑤): 공급자 → 연결 → 연결 진단 → 키 보호 → 표시 → 데이터 → 프로필.
  import type { Snippet } from 'svelte';
  import type { App } from '../lib/state/app.svelte';
  import type { Settings } from '../lib/state/schema';
  import Segmented from '../lib/ui/components/Segmented.svelte';
  import Layout from '../lib/ui/Layout.svelte';
  import Rail from '../lib/ui/Rail.svelte';
  import ConnectionForm from '../lib/ui/settings/ConnectionForm.svelte';
  import DataTools from '../lib/ui/settings/DataTools.svelte';
  import Diagnostics from '../lib/ui/settings/Diagnostics.svelte';
  import KeyLock from '../lib/ui/settings/KeyLock.svelte';
  import Profiles from '../lib/ui/settings/Profiles.svelte';
  import ProviderCards from '../lib/ui/settings/ProviderCards.svelte';

  let { app, barEnd }: { app: App; barEnd: Snippet } = $props();

  // 비교 화면의 오류 배너(`진단 열기`·`키 다시 입력`)로 들어오면 그 구역으로 옮기고 제목에 초점을 둔다.
  const SECTION_IDS = { connection: 'set-connection', diagnostics: 'set-diag', data: 'set-data' } as const;
  $effect(() => {
    const section = app.route.section;
    if (!section) return;
    const h = document.getElementById(SECTION_IDS[section]);
    if (!h) return;
    h.scrollIntoView?.({ block: 'start' });
    h.focus({ preventScroll: true });
  });

  const THEMES = [
    { value: 'system', label: '시스템' },
    { value: 'light', label: '라이트' },
    { value: 'dark', label: '다크' },
  ];
  const COLORS = [
    { value: 'kr', label: '한국식 빨강▲ 파랑▼' },
    { value: 'global', label: '글로벌 초록▲ 빨강▼' },
  ];
</script>

<Layout>
  {#snippet rail()}
    <Rail {app} />
  {/snippet}

  {#snippet bar()}
    <button type="button" class="back" aria-label="비교로 돌아가기" onclick={() => app.navigate({ name: 'compare' })}>
      ‹
    </button>
    <span class="title">설정</span>
    <span class="spacer"></span>
    {@render barEnd()}
  {/snippet}

  {#snippet main()}
    <!-- 프로필이 바뀌면 입력 중인 값·진단 결과·닫은 권장 배너를 모두 새로 시작한다(다른 프로필에 저장되지 않게). -->
    {#key app.meta.activeProfileId}
      <div class="settings">
        <div class="note">
          <b>프로필은 편의 기능이지 보안 경계가 아니에요</b>
          <span>키와 설정은 이 브라우저에만 저장돼요. 같은 브라우저를 쓰는 사람은 저장된 키를 볼 수 있으니, 키는 암호로 잠가 두세요.</span>
        </div>

        <section aria-labelledby="set-provider">
          <h2 id="set-provider">데이터 공급자</h2>
          <ProviderCards value={app.settings.provider} onchange={(provider) => app.updateSettings({ provider })} />
        </section>

        <section aria-labelledby="set-connection">
          <h2 id="set-connection" tabindex="-1">연결</h2>
          <ConnectionForm {app} />
        </section>

        <section aria-labelledby="set-diag">
          <h2 id="set-diag" tabindex="-1">연결 진단</h2>
          <Diagnostics {app} />
        </section>

        <section aria-labelledby="set-lock">
          <h2 id="set-lock">키 보호</h2>
          <KeyLock {app} />
        </section>

        <section aria-labelledby="set-display">
          <h2 id="set-display">표시</h2>
          <div class="card">
            <div class="row">
              <span>테마</span>
              <Segmented
                label="테마"
                options={THEMES}
                value={app.settings.theme}
                onchange={(v) => app.updateSettings({ theme: v as Settings['theme'] })}
              />
            </div>
            <div class="row">
              <span>상승·하락 색</span>
              <Segmented
                label="상승·하락 색"
                options={COLORS}
                value={app.settings.colorConvention}
                onchange={(v) => app.updateSettings({ colorConvention: v as Settings['colorConvention'] })}
              />
            </div>
          </div>
        </section>

        <section aria-labelledby="set-data">
          <h2 id="set-data" tabindex="-1">데이터</h2>
          <DataTools {app} />
        </section>

        <section aria-labelledby="set-profiles">
          <h2 id="set-profiles">프로필</h2>
          <Profiles {app} />
        </section>
      </div>
    {/key}
  {/snippet}
</Layout>

<style>
  .settings {
    max-width: 720px;
    padding: 4px var(--gutter) 48px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .note {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
    border-radius: var(--r-card);
    background: var(--surface2);
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .note b {
    color: var(--t1);
  }
  h2 {
    font-size: var(--fs-label);
    font-weight: 700;
    color: var(--t3);
    letter-spacing: 0.04em;
    padding: 18px 4px 8px;
  }
  .card {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 4px 16px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
    font-size: var(--fs-body);
  }
  .row:last-child {
    border-bottom: 0;
  }
  .back {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    font-size: 24px;
    color: var(--t2);
    flex: none;
  }
  .back:hover {
    background: var(--surface2);
  }
  .title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
</style>
