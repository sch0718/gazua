// 카카오톡으로 공유 링크 보내기. 키는 빌드 때 넣고(VITE_KAKAO_JS_KEY), 없으면 기능을 끈다(링크 복사만).
// 메시지에는 만든 공유 링크와 스냅샷의 사람이 읽는 요약, 카드 이미지만 쓴다. 스냅샷 원문(JSON)·원본 ID·키는 넣지 않는다.
// 카드 이미지 업로드는 SDK 2.8.4의 Share.uploadImage(POST https://kapi.kakao.com/v2/api/talk/message/image/upload, FormData)다.
// @sch0718/kakao-share 0.1.1의 KakaoSdk 타입에는 없어서 여기서 넓혀 부른다(근거: 설계 4.4, kakao.min.js 88,359 B, 2026-10-29).
import type { KakaoCard, KakaoShareConfig } from '@sch0718/kakao-share';
import { kindLabel } from './kinds';
import { cardLines, type SymbolNames } from './shareText';
import type { ShareSnapshot } from './snapshot';

type Env = Record<string, string | boolean | undefined>;

export function readKakaoConfig(env: Env = import.meta.env): KakaoShareConfig | null {
  const key = typeof env.VITE_KAKAO_JS_KEY === 'string' ? env.VITE_KAKAO_JS_KEY.trim() : '';
  return key ? { appKey: key } : null;
}

export interface KakaoImage {
  url: string;
  width: number;
  height: number;
}
interface KakaoShareImages {
  uploadImage(o: { file: File[] | FileList }): Promise<{ infos: { original: KakaoImage } }>;
  deleteImage(o: { imageUrl: string }): Promise<unknown>;
}
const images = (): Partial<KakaoShareImages> | undefined => (globalThis as { Kakao?: { Share?: Partial<KakaoShareImages> } }).Kakao?.Share;

export const UPLOAD_TIMEOUT_MS = 15_000;
/** 고정 이미지는 캡처 카드와 같은 2:1이다(설계 1.5-9) */
export const FIXED_IMAGE = { width: 800, height: 400 } as const;

const validImage = (o: unknown): o is KakaoImage => {
  const x = o as Partial<KakaoImage> | undefined;
  return typeof x?.url === 'string' && x.url.startsWith('https://') && typeof x.width === 'number' && typeof x.height === 'number' && x.width >= 200 && x.height >= 200;
};

/** 실패는 무시한다 */
export function deleteCardImage(url: string): void {
  try {
    Promise.resolve(images()?.deleteImage?.({ imageUrl: url })).catch(() => {});
  } catch {
    // SDK가 동기로 던져도 무시한다
  }
}

/** preloadKakao 뒤에 부른다. https 주소이고 200×200 이상일 때만 돌려주고, 아니면 null(카드는 고정 이미지) */
export async function uploadCardImage(file: File, timeoutMs = UPLOAD_TIMEOUT_MS): Promise<KakaoImage | null> {
  const upload = images()?.uploadImage;
  if (!upload) return null;
  let sent: Promise<{ infos: { original: KakaoImage } }>;
  try {
    sent = upload({ file: [file] });
  } catch {
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'timeout'>((r) => (timer = setTimeout(() => r('timeout'), timeoutMs)));
  try {
    const r = await Promise.race([sent, late]);
    if (r === 'timeout') {
      // 늦게 온 응답의 이미지는 보내지 않으므로 지운다
      sent.then((x) => typeof x?.infos?.original?.url === 'string' && deleteCardImage(x.infos.original.url)).catch(() => {});
      return null;
    }
    const o = r?.infos?.original;
    const url = o?.url;
    if (validImage(o)) return { url: o.url, width: o.width, height: o.height };
    if (typeof url === 'string') deleteCardImage(url);
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 카드 제목은 `{종류} 공유: {제목}`, 설명은 두 줄(설계 4.5). image가 없으면 종류별 고정 이미지(share/<kind>.png, 800×400) */
export function kakaoCard(snapshot: ShareSnapshot, url: string, opts: { names?: SymbolNames; image?: KakaoImage | null; line?: string | null } = {}): KakaoCard {
  const image = opts.image ?? null;
  return {
    title: `${kindLabel(snapshot.kind)} 공유: ${snapshot.title}`,
    description: cardLines(snapshot, opts.names, opts.line ?? null).slice(0, 2).join('\n'),
    // 카카오가 서버에서 받아 가는 이미지라 공유 링크와 같은 출처의 절대 주소를 쓴다
    imageUrl: image ? image.url : new URL(`share/${snapshot.kind}.png`, url).href,
    imageWidth: image ? image.width : FIXED_IMAGE.width,
    imageHeight: image ? image.height : FIXED_IMAGE.height,
    url,
    buttonTitle: '열어 보기',
  };
}
