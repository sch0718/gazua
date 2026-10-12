export type SnackbarAction = { label: string; run: () => void };
export type SnackbarItem = { id: number; message: string; action?: SnackbarAction };

let current = $state<SnackbarItem | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

/** 렌더링용 현재 스낵바(없으면 null). */
export function currentSnackbar(): SnackbarItem | null {
  return current;
}

export function dismissSnackbar(): void {
  clearTimeout(timer);
  timer = undefined;
  current = null;
}

/** 새 스낵바는 이전 것을 대체하고 타이머도 새로 시작한다. */
export function showSnackbar(message: string, action?: SnackbarAction, ms = 5000): void {
  clearTimeout(timer);
  const id = ++seq;
  current = { id, message, action };
  timer = setTimeout(() => {
    if (current?.id === id) dismissSnackbar();
  }, ms);
}

/** 버튼 동작: 먼저 닫고 실행한다(동작이 새 스낵바를 띄워도 지워지지 않게). */
export function runSnackbarAction(): void {
  const run = current?.action?.run;
  dismissSnackbar();
  run?.();
}
