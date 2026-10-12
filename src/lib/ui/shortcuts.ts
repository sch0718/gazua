// 키보드 단축키(스펙 7.6). 화면과 무관한 바인딩만 맡고, 무엇을 할지는 호출하는 쪽이 정한다.

export interface ShortcutHandlers {
  /** `/` 종목 검색 */
  search(): void;
  /** `[` 한 단계 짧은 기간 */
  prevPeriod(): void;
  /** `]` 한 단계 긴 기간 */
  nextPeriod(): void;
  /** `m` 지표 선택 */
  metric(): void;
  /** `v` 거래소 모드 순환 */
  cycleVenue(): void;
  /** `h` 선택 종목 숨기기·보이기 */
  toggleHidden(): void;
  /** `?` 단축키 도움말 */
  help(): void;
}

/** 글자를 입력받는 요소. 여기서는 단축키가 아니라 입력이다. */
function isTextEntry(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

const KEYS: Record<string, keyof ShortcutHandlers> = {
  '/': 'search',
  '[': 'prevPeriod',
  ']': 'nextPeriod',
  m: 'metric',
  M: 'metric',
  v: 'cycleVenue',
  V: 'cycleVenue',
  h: 'toggleHidden',
  H: 'toggleHidden',
  '?': 'help',
};

/** 한글 자판처럼 e.key가 ASCII가 아닐 때 쓰는 물리 키. 대문자·Shift 조합은 호출하는 쪽에서 가린다. */
const CODES: Record<string, keyof ShortcutHandlers> = {
  Slash: 'search',
  BracketLeft: 'prevPeriod',
  BracketRight: 'nextPeriod',
  KeyM: 'metric',
  KeyV: 'cycleVenue',
  KeyH: 'toggleHidden',
};
const PRINTABLE_ASCII = /^[\x20-\x7e]$/;

/** 눌린 키가 맡은 동작. ASCII 키는 e.key로, 한글 자판 등 그 밖의 키는 물리 키(e.code)로 정한다. */
function resolve(e: KeyboardEvent): keyof ShortcutHandlers | undefined {
  if (PRINTABLE_ASCII.test(e.key)) return Object.hasOwn(KEYS, e.key) ? KEYS[e.key] : undefined;
  if (e.code === 'Slash') return e.shiftKey ? 'help' : 'search';
  if (e.shiftKey && e.code.startsWith('Bracket')) return undefined;
  return Object.hasOwn(CODES, e.code) ? CODES[e.code] : undefined;
}

/** 단축키를 달고, 떼는 함수를 돌려준다. 입력 요소에 포커스가 있거나 Ctrl/Meta/Alt가 눌려 있으면 무시한다. */
export function bindShortcuts(target: Document, h: ShortcutHandlers): () => void {
  function onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return;
    const name = resolve(e);
    if (!name) return;
    if (isTextEntry(e.target as Element | null) || isTextEntry(target.activeElement)) return;
    e.preventDefault();
    h[name]();
  }
  target.addEventListener('keydown', onkeydown);
  return () => target.removeEventListener('keydown', onkeydown);
}
