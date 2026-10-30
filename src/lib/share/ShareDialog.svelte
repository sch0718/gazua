<script lang="ts" module>
  import type { ShareReduction } from './snapshot';
  /** 줄인 단계 안내(설계 3.4, 「내가 정한 기본값」 10번) */
  export const REDUCTION_TEXT: Record<ShareReduction, string> = {
    'skipped-counts': '건너뛴 신호는 이유별 개수만 보내요',
    'no-values': '선정 이력의 조건 계산값은 빼고 보내요',
    thinned: '곡선은 점 수를 줄여 보내요',
    'codes-only': '선정 이력은 종목 코드만 보내요',
  };
  export const tooLargeText = (bytes: number) => `결과가 너무 커서 공유할 수 없어요(약 ${Math.ceil(bytes / 1024)} KB, 한도 100 KB). 기간이나 종목을 줄여 다시 실행해 주세요`;
  export const INVALID_TEXT = '이 결과는 공유 형식으로 바꾸지 못했어요';
</script>

<script lang="ts">
  // 읽기 전용 공유 링크 만들기(제안서 6절): 보낼 내용을 먼저 보여 주고, 만료(기본 7일·최대 30일)를 고른 뒤 링크를 만든다.
  import { Sheet } from '@sch0718/ui-svelte';
  import { showSnackbar } from '@sch0718/ui-svelte';
  import type { SyncController } from '../sync/controller.svelte';
  import { SHARE_TTL_DEFAULT_DAYS, SHARE_TTL_MAX_DAYS, type ShareBuild, type ShareSnapshot } from './snapshot';
  import { jsonBytes } from '../sync/forbidden';
  import type { CardCapture, ShareRequest } from './shareStore.svelte';
  import { kindLabel } from './kinds';
  import type { UniverseItem } from '../data/universe';
  import { sharedUniverse } from '../../sheets/universeSource';
  import { snapshotLines, symbolNames, type SymbolNames } from './shareText';
  import { kakaoLinkFits, preloadKakao, sendKakao, type KakaoShareConfig } from '@sch0718/kakao-share';
  import { untrack } from 'svelte';
  import { cardFile } from './cardImage';
  import { deleteCardImage, kakaoCard, readKakaoConfig, uploadCardImage, type KakaoImage } from './kakao';

  let {
    request,
    sync,
    onclose,
    copy = (text: string) => navigator.clipboard.writeText(text),
    universe = sharedUniverse,
    kakao = readKakaoConfig(),
  }: {
    request: ShareRequest | null;
    sync: SyncController;
    onclose: () => void;
    copy?: (text: string) => Promise<void>;
    universe?: () => Promise<UniverseItem[]>;
    /** 카카오 JS 키(빌드 설정). 없으면 카카오톡 단추를 숨기고 링크 복사만 둔다. */
    kakao?: KakaoShareConfig | null;
  } = $props();

  // 종목 이름은 앱의 종목 목록에서 찾는다(열었을 때만 받는다). 받지 못하면 코드만 보인다.
  let names = $state<SymbolNames | undefined>(undefined);
  const opened = $derived(request !== null);
  $effect(() => {
    if (!opened || names) return;
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

  const uid = Math.random().toString(36).slice(2, 8);
  let ttl = $state(SHARE_TTL_DEFAULT_DAYS);
  let hideCapital = $state(true);
  // 링크와 함께 그 링크를 만든 스냅샷을 둔다. 카카오톡 메시지는 이 스냅샷의 요약만 쓴다.
  let link = $state<{ url: string; expiresAt: number; snapshot: ShareSnapshot } | null>(null);
  let failed = $state<string | null>(null);

  // 캡처: 카카오 키가 있고 capture가 있으면 열 때 한 번(보이는 화면 그대로). null이면 캡처 부분을 숨기고 고정 이미지(설계 4.2)
  let shot = $state.raw<CardCapture | null>(null);
  let preview = $state<string | null>(null);
  /** 「화면 캡처 함께 보내기」. 링크 전 화면에서만 정한다 */
  let sendShot = $state(true);
  /** 「이미지 빼고 보내기」를 눌렀다(되돌리지 않는다) */
  let dropped = $state(false);
  let cardImage = $state.raw<KakaoImage | null>(null);
  let uploadNote = $state<string | null>(null);
  let sent = false;

  function takeShot(r: ShareRequest | null): CardCapture | null {
    if (!r?.capture || !kakao) return null;
    try {
      return r.capture();
    } catch {
      return null;
    }
  }
  /** 보내지 않은 캡처는 카카오 서버에서 지운다(설계 1.5-8) */
  function discardImage() {
    if (cardImage && !sent) deleteCardImage(cardImage.url);
    cardImage = null;
  }
  function resetShot(r: ShareRequest | null) {
    discardImage();
    sent = false;
    dropped = false;
    sendShot = true;
    uploadNote = null;
    shot = untrack(() => takeShot(r));
    try {
      preview = shot ? shot.canvas.toDataURL('image/jpeg', 0.85) : null;
    } catch {
      shot = null;
      preview = null;
    }
  }

  const build = $derived.by<ShareBuild | null>(() => {
    if (!request) return null;
    try {
      return request.build(hideCapital);
    } catch {
      return { ok: false, code: 'invalid' };
    }
  });
  const snapshot = $derived<ShareSnapshot | null>(build?.ok ? build.snapshot : null);
  const isResult = $derived(request?.kind === 'simResult' || request?.kind === 'validation');
  const hasCapital = $derived(request !== null && ['strategy', 'criteria', 'simResult', 'validation'].includes(request.kind));
  /** 규칙 부분: 결과 종류는 strategy 또는 criteria·baskets만(들여 쓴 JSON) */
  const rulesPart = $derived.by(() => {
    const s = snapshot;
    if (!s) return null;
    if (s.kind === 'simResult') return { strategy: s.strategy };
    if (s.kind === 'validation') return { criteria: s.criteria, baskets: s.baskets };
    return s;
  });
  const sizeKb = $derived(snapshot && isResult ? Math.max(1, Math.round(jsonBytes(snapshot) / 1024)) : 0);
  let rawOpen = $state(false);
  $effect(() => {
    if (snapshot === null) rawOpen = false;
  });
  const ttlValid = $derived(Number.isInteger(ttl) && ttl >= 1 && ttl <= SHARE_TTL_MAX_DAYS);

  // 닫거나 다른 공유를 열면 늘린다. 그 전에 보낸 요청의 응답은 버린다(다른 대상에 이전 링크가 보이지 않게).
  let attempt = 0;
  async function create() {
    if (!request || !snapshot || !ttlValid) return;
    const mine = ++attempt;
    failed = null;
    sync.clearError();
    const sent = snapshot;
    const made = await sync.createShare(request.profileId, request.kind, sent, ttl);
    if (mine !== attempt) return;
    link = made && { ...made, snapshot: sent };
    if (!link) failed = sync.error ?? '링크를 만들지 못했어요';
  }
  $effect(() => {
    void request;
    attempt++;
    link = null;
    failed = null;
    rawOpen = false;
    untrack(() => resetShot(request));
  });

  async function copyLink() {
    if (!link) return;
    try {
      await copy(link.url);
      showSnackbar('링크를 복사했어요');
    } catch {
      showSnackbar('복사하지 못했어요. 링크를 길게 눌러 복사해 주세요');
    }
  }

  // 링크가 생기면 SDK를 미리 받는다. 클릭 안에서 기다림 없이 보내야 PC 팝업 차단을 피한다.
  // 받지 못하면 단추를 숨기고 링크 복사만 남긴다.
  let kakaoState = $state<'off' | 'loading' | 'uploading' | 'ready'>('off');
  const kakaoUrl = $derived(link && kakao && kakaoLinkFits(link.url, kakao) ? link.url : null);
  $effect(() => {
    if (!kakaoUrl || !kakao) {
      kakaoState = 'off';
      return;
    }
    let alive = true;
    kakaoState = 'loading';
    preloadKakao(kakao).then(
      async () => {
        if (!alive) return;
        const s = untrack(() => (sendShot && !dropped && !cardImage ? shot : null));
        if (s) {
          kakaoState = 'uploading';
          const file = await cardFile(s.canvas);
          if (!alive || dropped) return;
          const img = file ? await uploadCardImage(file) : null;
          // 다른 요청으로 바뀌었거나(alive) 이미지를 뺐으면(dropped) 늦게 온 응답은 버리고 그 이미지를 지운다
          if (!alive || dropped) {
            if (img) deleteCardImage(img.url);
            if (!alive) return;
          } else {
            cardImage = img;
            if (!img) uploadNote = '캡처를 올리지 못해 기본 그림으로 보내요';
          }
        }
        kakaoState = 'ready';
      },
      () => {
        if (alive) kakaoState = 'off';
      },
    );
    return () => {
      alive = false;
    };
  });

  function dropImage() {
    dropped = true;
    discardImage();
    if (kakaoState === 'uploading') kakaoState = 'ready';
  }

  function sendToKakao() {
    if (!link || !kakao) return;
    const card = kakaoCard(link.snapshot, link.url, { names, image: dropped ? null : cardImage, line: shot?.line ?? null });
    sent = sendKakao(card, kakao);
    if (!sent) showSnackbar('카카오톡을 열지 못했어요. 링크를 복사해 보내 주세요');
  }

  function close() {
    discardImage();
    attempt++;
    link = null;
    failed = null;
    rawOpen = false;
    ttl = SHARE_TTL_DEFAULT_DAYS;
    hideCapital = true;
    sent = false;
    dropped = false;
    sendShot = true;
    shot = null;
    preview = null;
    uploadNote = null;
    onclose();
  }

  const fmtDate = (t: number) => new Date(t).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
</script>

<Sheet open={request !== null} title={request ? `${kindLabel(request.kind)} 공유` : '공유'} onclose={close}>
  {#if request && build}
    <div class="share">
      {#if link}
        <p class="lead">링크를 가진 사람은 누구나 {fmtDate(link.expiresAt)}까지 읽을 수 있어요.</p>
        <input class="url" readonly value={link.url} aria-label="공유 링크" onfocus={(e) => e.currentTarget.select()} />
        <button type="button" class="primary" onclick={copyLink}>링크 복사</button>
        {#if kakaoState !== 'off'}
          {#if preview && sendShot && !dropped && (kakaoState === 'uploading' || cardImage)}
            <div class="shot-mini">
              <img src={preview} alt={shot?.alt ?? ''} width="160" height="80" />
              <button type="button" class="ghost" onclick={dropImage}>이미지 빼고 보내기</button>
            </div>
          {/if}
          <div aria-live="polite">
            <button type="button" class="kakao" disabled={kakaoState !== 'ready'} onclick={sendToKakao}>
              {kakaoState === 'ready' ? '카카오톡으로 보내기' : kakaoState === 'uploading' ? '캡처 올리는 중…' : '카카오톡 준비 중…'}
            </button>
            {#if uploadNote}<p class="hint">{uploadNote}</p>{/if}
          </div>
        {/if}
        <p class="hint">설정 › 동기화 › 내 공유에서 언제든 철회할 수 있어요. 이미 본 내용·캡처는 지울 수 없어요.</p>
      {:else}
        {#if !build.ok}
          <p class="err" role="alert">{build.code === 'too-large' ? tooLargeText(build.bytes) : INVALID_TEXT}</p>
          {#if build.code === 'invalid' && build.path}
            <details>
              <summary>보낼 원문 보기</summary>
              <pre>{build.path}</pre>
            </details>
          {/if}
        {:else if snapshot}
          <p class="lead">아래 내용만 보내요. 프로필 이름·키·계좌·프록시 주소는 넣지 않아요.</p>
          {#if build.reduced.length > 0}
            <ul class="reduced" aria-label="줄인 내용">
              {#each build.reduced as r (r)}<li>{REDUCTION_TEXT[r]}</li>{/each}
            </ul>
          {/if}
          <ul class="preview" aria-label="보낼 내용">
            {#each snapshotLines(snapshot, names) as line, i (i)}<li>{line}</li>{/each}
          </ul>
          <details>
            <summary>보낼 원문 보기</summary>
            <pre>{JSON.stringify(rulesPart, null, 2)}</pre>
          </details>
          {#if isResult}
            <details open={rawOpen} ontoggle={(e) => (rawOpen = e.currentTarget.open)}>
              <summary>결과 원문(약 {sizeKb} KB)</summary>
              {#if rawOpen && (snapshot.kind === 'simResult' || snapshot.kind === 'validation')}<pre>{JSON.stringify(snapshot.result)}</pre>{/if}
            </details>
          {/if}
          {#if kakao && preview}
            <figure class="shot">
              <img src={preview} alt={shot?.alt ?? ''} width="400" height="200" />
            </figure>
            <label class="check">
              <input type="checkbox" bind:checked={sendShot} disabled={sync.busy} />
              화면 캡처 함께 보내기
            </label>
            <p class="hint">링크를 만들면 이 캡처를 카카오 서버에 바로 올려요(카카오톡 카드에 넣으려고요). 링크를 철회해도 카카오톡으로 보낸 캡처는 지울 수 없어요.</p>
          {/if}
        {/if}
        {#if hasCapital}
          <label class="check">
            <input type="checkbox" bind:checked={hideCapital} disabled={sync.busy} />
            {isResult ? '가상 초기 자금과 금액·수량 빼기' : '가상 초기 자금 빼기'}
          </label>
        {/if}
        <label class="ttl" for="share-ttl-{uid}">
          만료(일)
          <input id="share-ttl-{uid}" type="number" min="1" max={SHARE_TTL_MAX_DAYS} step="1" bind:value={ttl} disabled={sync.busy} aria-invalid={ttlValid ? undefined : 'true'} />
        </label>
        {#if !ttlValid}<p class="err" role="alert">1~{SHARE_TTL_MAX_DAYS}일 사이로 정해 주세요</p>{/if}
        {#if failed}<p class="err" role="alert">{failed}</p>{/if}
        <button type="button" class="primary" disabled={!snapshot || !ttlValid || sync.busy} onclick={create}>{sync.busy ? '만드는 중…' : '링크 만들기'}</button>
      {/if}
    </div>
  {/if}
</Sheet>

<style>
  .shot img {
    width: 100%;
    height: auto;
    border-radius: 12px;
  }
  .shot-mini {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .shot-mini img {
    border-radius: 8px;
  }
  .ghost {
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 12px;
    background: var(--surface2);
  }
  .share {
    display: flex;
    flex-direction: column;
    gap: 12px;
    /* 시트 제목(왼쪽 20px)과 맞춘다. 시트 본문에는 기본 여백이 없다. */
    padding: 0 20px 8px;
  }
  .lead {
    font-size: var(--fs-body);
  }
  .hint {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .preview,
  .reduced {
    background: var(--surface2);
    border-radius: 12px;
    padding: 10px 14px 10px 28px;
    font-size: var(--fs-sub);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .reduced {
    color: var(--t2);
  }
  details summary {
    cursor: pointer;
    font-size: var(--fs-sub);
    color: var(--t2);
    min-height: var(--touch);
    display: flex;
    align-items: center;
  }
  pre {
    max-height: 240px;
    overflow: auto;
    font-size: 12px;
    background: var(--surface2);
    border-radius: 12px;
    padding: 10px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .check,
  .ttl {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--touch);
    font-size: var(--fs-body);
  }
  .check input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .ttl input {
    width: 80px;
    min-height: var(--touch);
    border-radius: 10px;
    border: 1px solid var(--line);
    padding: 0 10px;
    background: var(--surface);
    color: var(--t1);
  }
  .url {
    width: 100%;
    min-height: var(--touch);
    border-radius: 10px;
    border: 1px solid var(--line);
    padding: 0 10px;
    background: var(--surface);
    color: var(--t1);
    font-size: var(--fs-sub);
  }
  .primary {
    min-height: var(--touch);
    border-radius: 12px;
    background: var(--accent);
    color: var(--on-accent, #fff);
    font-weight: 700;
  }
  .kakao {
    min-height: var(--touch);
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--t1);
    font-weight: 700;
  }
  .kakao:disabled,
  .primary:disabled {
    opacity: 0.5;
  }
  .err {
    color: var(--warn);
    font-size: var(--fs-sub);
  }
</style>
