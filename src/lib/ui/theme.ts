export type ThemeChoice = 'system' | 'light' | 'dark';
export type ColorConvention = 'kr' | 'global';

/** `system`이면 data-theme을 지워 prefers-color-scheme을 따른다. */
export function applyTheme(t: ThemeChoice): void {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
}

/** 한국식(빨강▲/파랑▼) 또는 글로벌(초록▲/빨강▼). `--up/--down` 값만 바뀐다. */
export function applyColorConvention(c: ColorConvention): void {
  document.documentElement.classList.toggle('global-colors', c === 'global');
}
