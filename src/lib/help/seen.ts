import { createSeenStore, type SeenStore } from '@sch0718/seen-store';
import { HELP_PAGES, type HelpPageId } from './content';

// 메뉴별 처음 안내를 본 기록. 이 기기(브라우저)에만 남고 프로필·내보내기 파일에는 들어가지 않는다.
// 저장 형식(JSON 배열)이 공용 패키지와 같아서 키만 그대로 두면 이전 기록을 이어 쓴다.
export const HELP_SEEN_KEY = 'gazua:help-seen:v1';
const IDS: readonly HelpPageId[] = HELP_PAGES.map((p) => p.id);

/** 저장소가 막히면 이번 페이지 로드 동안 메모리만 쓴다. */
export function createHelpSeenStore(storage?: () => Storage): HelpSeenStore {
  return createSeenStore({ key: HELP_SEEN_KEY, ids: IDS, storage });
}

export type HelpSeenStore = SeenStore<HelpPageId>;

/** 앱 전체가 함께 쓰는 기록(이 브라우저의 localStorage). */
export const helpSeen = createHelpSeenStore();
