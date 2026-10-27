// 테마 적용은 @sch0718/ui-svelte가 한다. 색 관례(등락색)는 가즈아 전용이다.
export { applyTheme, type ThemeChoice } from '@sch0718/ui-svelte';

export type ColorConvention = 'kr' | 'global';

/** 한국식(빨강▲/파랑▼) 또는 글로벌(초록▲/빨강▼). `--up/--down` 값만 바뀐다. */
export function applyColorConvention(c: ColorConvention): void {
  document.documentElement.classList.toggle('global-colors', c === 'global');
}
