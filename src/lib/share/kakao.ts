// 카카오톡으로 공유 링크 보내기. 키는 빌드 때 넣고(VITE_KAKAO_JS_KEY), 없으면 기능을 끈다(링크 복사만).
// 메시지에는 만든 공유 링크와 스냅샷의 사람이 읽는 요약만 쓴다. 스냅샷 원문(JSON)·원본 ID·키는 넣지 않는다.
import type { KakaoCard, KakaoShareConfig } from '@sch0718/kakao-share';
import type { ShareSnapshot } from './snapshot';
import { snapshotLines, type SymbolNames } from './shareText';

type Env = Record<string, string | boolean | undefined>;

export function readKakaoConfig(env: Env = import.meta.env): KakaoShareConfig | null {
  const key = typeof env.VITE_KAKAO_JS_KEY === 'string' ? env.VITE_KAKAO_JS_KEY.trim() : '';
  return key ? { appKey: key } : null;
}

const KIND = { group: '그룹', strategy: '전략', criteria: '선정 기준' } as const;

/** 카드 설명은 두 줄까지 보인다. 제목 줄을 빼고 앞의 두 줄을 쓴다. */
export function kakaoCard(snapshot: ShareSnapshot, url: string, names?: SymbolNames): KakaoCard {
  const lines = snapshotLines(snapshot, names).filter((l) => !l.startsWith('제목: '));
  return {
    title: `${KIND[snapshot.kind]} 공유: ${snapshot.title}`,
    description: lines.slice(0, 2).join('\n'),
    // 카카오가 서버에서 받아 가는 이미지라 공유 링크와 같은 출처의 절대 주소를 쓴다.
    imageUrl: new URL('icon-512.png', url).href,
    imageWidth: 512,
    imageHeight: 512,
    url,
    buttonTitle: '열어 보기',
  };
}
