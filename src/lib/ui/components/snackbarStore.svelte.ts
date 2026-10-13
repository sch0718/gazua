export type SnackbarAction = { label: string; run: () => void };
export type SnackbarItem = { id: number; message: string; action?: SnackbarAction };

let current = $state<SnackbarItem | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
// 포커스가 스낵바 안에 있는 동안 타이머를 멈춘다. 멈출 때 남은 시간을 재 두고, 놓으면 그 남은 시간만큼 다시 흐른다.
let deadline = 0;
let remaining = 0;
let held = false;

/** 렌더링용 현재 스낵바(없으면 null). */
export function currentSnackbar(): SnackbarItem | null {
  return current;
}

export function dismissSnackbar(): void {
  clearTimeout(timer);
  timer = undefined;
  held = false;
  current = null;
}

function arm(id: number, ms: number): void {
  deadline = Date.now() + ms;
  timer = setTimeout(() => {
    if (current?.id === id) dismissSnackbar();
  }, ms);
}

/** 새 스낵바는 이전 것을 대체하고 타이머도 새로 시작한다(멈춤도 풀린다). */
export function showSnackbar(message: string, action?: SnackbarAction, ms = 5000): void {
  clearTimeout(timer);
  held = false;
  const id = ++seq;
  current = { id, message, action };
  arm(id, ms);
}

/** 포커스가 스낵바로 들어오면 부른다: 타이머를 멈추고 남은 시간을 기억한다. */
export function holdSnackbar(): void {
  if (!current || held) return;
  held = true;
  clearTimeout(timer);
  timer = undefined;
  remaining = Math.max(0, deadline - Date.now());
}

/** 포커스가 스낵바를 떠나면 부른다: 처음부터가 아니라 남은 시간부터 다시 흐른다(사용자 지정 길이도 그대로). */
export function releaseSnackbar(): void {
  if (!current || !held) return;
  held = false;
  arm(current.id, remaining);
}

/** 버튼 동작: 먼저 닫고 실행한다(동작이 새 스낵바를 띄워도 지워지지 않게). */
export function runSnackbarAction(): void {
  const run = current?.action?.run;
  dismissSnackbar();
  run?.();
}
