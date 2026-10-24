<script lang="ts">
  import type { HelpPage } from '../../help/content';
  import type { Settings } from '../../state/schema';

  // 문서(docs/help)와 앱이 같은 그림(public/help/img)을 쓴다. 테마가 `시스템`이면 브라우저가 밝기에 맞춰 고른다.
  // 좁은 화면(<600)에서는 그림(960×520) 중 오른쪽 휴대폰 화면(x 600–900, y 20–500)만 잘라 원래 크기로 보인다.
  // 왼쪽 단계 목록은 그림 아래 글에도 있으므로, 통째로 줄여 글자가 작아지는 것보다 낫다.
  let { page, theme, compact = false }: { page: HelpPage; theme: Settings['theme']; compact?: boolean } = $props();

  const src = (mode: 'light' | 'dark') => `${import.meta.env.BASE_URL}help/img/${page.id}-${mode}.svg`;
  const alt = $derived(`${page.title} 사용법: ${page.steps.map((s, i) => `${i + 1}. ${s.title.replace(/`/g, '')}`).join(' ')}`);
</script>

<div class="figure" class:compact>
  <picture>
    {#if theme === 'system'}<source media="(prefers-color-scheme: dark)" srcset={src('dark')} />{/if}
    <img src={src(theme === 'dark' ? 'dark' : 'light')} {alt} width="960" height="520" />
  </picture>
</div>

<style>
  .figure {
    width: 100%;
    margin: 0 auto;
    overflow: hidden;
    aspect-ratio: 960 / 520;
    border-radius: var(--r-card);
  }
  img {
    display: block;
    width: 100%;
    height: auto;
  }
  @media (max-width: 599px) {
    .figure {
      width: min(100%, 300px);
      aspect-ratio: 300 / 480;
      border-radius: 32px;
    }
    /* 처음 안내는 아래 글과 단추가 한 화면에 들어오게 그림 높이를 화면의 40% 안으로 줄인다(300/480 × 40vh = 25vh). */
    .figure.compact {
      width: min(100%, 300px, 25vh);
    }
    /* 여백 백분율은 감싼 상자의 너비 기준이다: 600/300 = 200%, 20/300 ≈ 6.667%. */
    img {
      width: 320%;
      max-width: none;
      margin: -6.667% 0 0 -200%;
    }
  }
</style>
