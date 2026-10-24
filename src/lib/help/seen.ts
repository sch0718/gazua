import { HELP_PAGES, type HelpPageId } from './content';

// 메뉴별 처음 안내를 본 기록. 이 기기(브라우저)에만 남고 프로필·내보내기 파일에는 들어가지 않는다.
export const HELP_SEEN_KEY = 'gazua:help-seen:v1';
const IDS: readonly string[] = HELP_PAGES.map((p) => p.id);

/** 저장소가 막히면 이번 페이지 로드 동안 메모리만 쓴다. */
export function createHelpSeenStore(storage: () => Storage = () => window.localStorage) {
  let memory = new Set<HelpPageId>();
  let memoryOnly = false;

  function read(): ReadonlySet<HelpPageId> {
    if (memoryOnly) return memory;
    let raw: string | null;
    try {
      raw = storage().getItem(HELP_SEEN_KEY);
    } catch {
      memoryOnly = true;
      return memory;
    }
    // 깨진 값은 빈 기록으로 본다. 다음 기록이 덮어쓴다.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw ?? '[]');
    } catch {
      parsed = [];
    }
    // 모르는 이름(다른 버전이 더한 메뉴 등)만 뺀다.
    memory = new Set(Array.isArray(parsed) ? parsed.filter((id): id is HelpPageId => IDS.includes(id)) : []);
    return memory;
  }

  function mark(id: HelpPageId) {
    memory = new Set([...read(), id]);
    if (memoryOnly) return;
    try {
      storage().setItem(HELP_SEEN_KEY, JSON.stringify([...memory]));
    } catch {
      memoryOnly = true;
    }
  }

  function reset() {
    memory = new Set();
    try {
      storage().removeItem(HELP_SEEN_KEY);
    } catch {
      memoryOnly = true;
    }
  }

  return { read, mark, reset };
}

export type HelpSeenStore = ReturnType<typeof createHelpSeenStore>;

/** 앱 전체가 함께 쓰는 기록(이 브라우저의 localStorage). */
export const helpSeen = createHelpSeenStore();
